import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase'
import { HEALTH_COLOR, HEALTH_LABEL, forecast, jobNumbers, type JobSummary } from '@/lib/forecast'
import { fmtDate, fmtDateTime, hrs, money, todaySydney } from '@/lib/format'
import {
  BudgetBar, Card, Empty, SectionTitle, Stat, StatusBadge,
  buttonClass, dangerButtonClass, inputClass, secondaryButtonClass,
} from '@/components/ui'
import { acceptQuote, addVariation, deleteVariation, rejectQuote, setJobStatus, updateJob } from './actions'

export const dynamic = 'force-dynamic'

type Entry = { id: string; worker_id: string; start_time: string; end_time: string | null; workers: { name: string; type: string } | null }
type Expense = {
  id: string; supplier: string | null; total: number; hours: number | null; expense_date: string | null
  status: string; category: string; worker_id: string | null; invoice_number: string | null; image_path: string | null
}

const entryHours = (e: Entry) =>
  ((e.end_time ? new Date(e.end_time) : new Date()).getTime() - new Date(e.start_time).getTime()) / 3600000

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ codeError?: string }> }) {
  const { id } = await params
  const { codeError } = await searchParams
  const supabase = createServiceClient()

  const [{ data: summary }, { data: job }, { data: entriesData }, { data: expensesData }, { data: variations }, { data: subbies }] =
    await Promise.all([
      supabase.from('job_summary').select('*').eq('id', id).maybeSingle(),
      supabase.from('jobs').select('quote_pdf_path, po_ref').eq('id', id).maybeSingle(),
      supabase.from('time_entries').select('id, worker_id, start_time, end_time, workers(name, type)').eq('job_id', id).order('start_time', { ascending: false }),
      supabase.from('expenses').select('id, supplier, total, hours, expense_date, status, category, worker_id, invoice_number, image_path').eq('job_id', id).order('created_at', { ascending: false }),
      supabase.from('variations').select('id, description, amount, hours, materials, created_at').eq('job_id', id).order('created_at'),
      supabase.from('workers').select('id, name').eq('type', 'subbie'),
    ])

  if (!summary || !job) notFound()
  const j = summary as JobSummary
  const entries = (entriesData ?? []) as unknown as Entry[]
  const expenses = (expensesData ?? []) as Expense[]

  // Subbie hours: compare what each subbie logged on WhatsApp with what they invoiced.
  const subbieName = new Map((subbies ?? []).map((s) => [s.id, s.name as string]))
  const rows = new Map<string, { name: string; logged: number; invoiced: number; linked: boolean }>()
  for (const e of entries) {
    if (e.workers?.type !== 'subbie') continue
    const r = rows.get(e.worker_id) ?? { name: e.workers.name, logged: 0, invoiced: 0, linked: true }
    r.logged += entryHours(e)
    rows.set(e.worker_id, r)
  }
  for (const x of expenses) {
    if (x.category !== 'subbie' || x.status === 'rejected') continue
    const key = x.worker_id ?? `supplier:${x.supplier ?? 'Unknown'}`
    const r = rows.get(key) ?? {
      name: x.worker_id ? subbieName.get(x.worker_id) ?? 'Subbie' : x.supplier ?? 'Unknown subbie',
      logged: 0, invoiced: 0, linked: !!x.worker_id,
    }
    r.invoiced += Number(x.hours ?? 0)
    rows.set(key, r)
  }
  const subbieRows = [...rows.entries()].map(([key, r]) => ({ key, ...r }))
  const subbieHours = subbieRows.reduce((s, r) => s + Math.max(r.invoiced, r.logged), 0)

  const nums = jobNumbers(j, subbieHours)
  const f = forecast(j, nums)
  const pdfUrl = job.quote_pdf_path
    ? (await supabase.storage.from('quotes').createSignedUrl(job.quote_pdf_path, 3600)).data?.signedUrl
    : null

  return (
    <div className="space-y-8">
      {codeError && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
          {codeError === 'used'
            ? 'That job code is already used by another job. Nothing was saved. Pick a different code.'
            : 'The job code must be 2–24 letters, numbers or dashes. Nothing was saved.'}
        </div>
      )}

      {/* Header */}
      <div>
        <Link href="/" className="text-gray-400 hover:text-white text-sm">← All jobs</Link>
        <div className="flex flex-wrap items-start justify-between gap-4 mt-3">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-blue-400 font-mono font-bold text-lg">{j.code}</span>
              <StatusBadge status={j.status} />
              {j.status === 'active' && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${HEALTH_COLOR[f.health]}`}>{HEALTH_LABEL[f.health]}</span>
              )}
            </div>
            <h1 className="text-2xl font-bold mt-1">{j.client_name ?? 'Unnamed job'}</h1>
            {j.address && <p className="text-gray-400">{j.address}</p>}
            <p className="text-gray-500 text-sm mt-1">
              {j.start_date && <>Start {fmtDate(j.start_date)} · Finish {fmtDate(j.planned_finish)} · </>}
              {job.po_ref && <>PO {job.po_ref} · </>}
              {pdfUrl && <a href={pdfUrl} target="_blank" className="text-blue-400 hover:underline">Quote PDF</a>}
            </p>
          </div>
          <div className="flex gap-2">
            {j.status === 'active' && (
              <form action={setJobStatus.bind(null, id, 'complete')}><button className={secondaryButtonClass}>Mark finished</button></form>
            )}
            {['complete', 'invoiced', 'paid'].includes(j.status) && (
              <form action={setJobStatus.bind(null, id, 'active')}><button className={secondaryButtonClass}>Reopen</button></form>
            )}
            {j.status === 'rejected' && (
              <form action={setJobStatus.bind(null, id, 'quoted')}><button className={secondaryButtonClass}>Move back to waiting</button></form>
            )}
          </div>
        </div>
      </div>

      {/* Decision */}
      {j.status === 'quoted' && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <h2 className="font-semibold text-green-400 mb-3">Accept quote</h2>
            <form action={acceptQuote.bind(null, id)} className="space-y-3">
              <label className="block text-sm">
                <span className="text-gray-300">Start date</span>
                <input type="date" name="start_date" required defaultValue={todaySydney()} className={`${inputClass} mt-1`} />
              </label>
              <label className="block text-sm">
                <span className="text-gray-300">Finish date <span className="text-gray-500">(optional)</span></span>
                <input type="date" name="planned_finish" className={`${inputClass} mt-1`} />
              </label>
              <label className="block text-sm">
                <span className="text-gray-300">Painters on the job</span>
                <input type="number" name="crew_size" min={1} defaultValue={2} className={`${inputClass} mt-1`} />
                <span className="text-gray-500 text-xs">
                  If no finish date, it&apos;s worked out from the quoted hours ({hrs(j.quoted_hours)}) at 8h per painter per day.
                </span>
              </label>
              <button className={`${buttonClass} w-full`}>Accept and start job</button>
            </form>
          </Card>
          <Card>
            <h2 className="font-semibold text-red-400 mb-3">Reject quote</h2>
            <form action={rejectQuote.bind(null, id)} className="space-y-3">
              <label className="block text-sm">
                <span className="text-gray-300">Why was it rejected?</span>
                <textarea name="reason" required rows={4} placeholder="e.g. Too expensive, went with another painter" className={`${inputClass} mt-1`} />
              </label>
              <button className={`${dangerButtonClass} w-full`}>Reject — move to Missed projects</button>
            </form>
          </Card>
        </div>
      )}

      {j.status === 'rejected' && (
        <Card>
          <p className="text-sm text-gray-400">Quoted {fmtDate(j.created_at)}</p>
          <p className="mt-1"><span className="text-red-400">Why: </span>{j.rejection_reason ?? '—'}</p>
        </Card>
      )}

      {/* Money */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Income (quote + variations)" value={money(nums.income)} />
        <Stat label="Costs so far" value={money(nums.costs)} sub={`Labour ${money(nums.labourCost)} · Materials ${money(nums.materialsCost)}`} />
        <Stat label="Profit so far" value={money(nums.profit)} tone={nums.profit >= 0 ? 'green' : 'red'} />
        <Stat
          label="Margin so far"
          value={nums.margin == null ? '—' : `${Math.round(nums.margin * 100)}%`}
          tone={nums.margin == null ? undefined : nums.margin >= 0.3 ? 'green' : nums.margin >= 0.15 ? 'yellow' : 'red'}
        />
      </div>

      {/* Budget */}
      <section>
        <SectionTitle>Budget</SectionTitle>
        <Card className="space-y-5">
          <BudgetBar label="Labour hours" used={nums.hoursUsed} budget={nums.hoursBudget} format={hrs} />
          <BudgetBar label="Materials" used={nums.materialsCost} budget={nums.materialsBudget} format={money} />
          {nums.hoursBudget == null && (
            <p className="text-sm text-yellow-400">No labour hours on this quote yet — add them under &quot;Edit job details&quot; below.</p>
          )}
        </Card>
      </section>

      {/* Forecast */}
      {j.status === 'active' && (
        <section>
          <SectionTitle>Forecast</SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Time gone" value={f.timePct == null ? '—' : `${Math.round(f.timePct * 100)}%`} sub="of planned working days" />
            <Stat
              label="Hours used"
              value={f.hoursPct == null ? '—' : `${Math.round(f.hoursPct * 100)}%`}
              sub="of hours budget"
              tone={f.health === 'over' ? 'red' : f.health === 'behind' ? 'yellow' : undefined}
            />
            <Stat
              label="Hours at finish (at this pace)"
              value={f.projectedHours == null ? '—' : hrs(f.projectedHours)}
              sub={nums.hoursBudget != null ? `budget ${hrs(nums.hoursBudget)}` : undefined}
              tone={f.projectedHours != null && nums.hoursBudget != null && f.projectedHours > nums.hoursBudget ? 'red' : undefined}
            />
            <Stat
              label="Projected profit"
              value={money(f.projectedProfit)}
              sub={f.projectedProfit == null ? 'needs worker rates or subbie invoices' : undefined}
              tone={f.projectedProfit == null ? undefined : f.projectedProfit >= 0 ? 'green' : 'red'}
            />
          </div>
          {f.budgetRunsOut && (
            <p className="text-sm text-gray-400 mt-3">
              At the current pace the hours budget runs out around{' '}
              <span className={j.planned_finish && f.budgetRunsOut < j.planned_finish ? 'text-red-400 font-medium' : 'text-gray-200'}>
                {fmtDate(f.budgetRunsOut)}
              </span>{' '}
              (planned finish {fmtDate(j.planned_finish)}).
            </p>
          )}
        </section>
      )}

      {/* Subbie hours check */}
      <section>
        <SectionTitle>Subbie hours check</SectionTitle>
        {subbieRows.length === 0 ? (
          <Empty>No subbie hours or invoices on this job yet.</Empty>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="text-left px-4 py-3 font-medium">Subbie</th>
                  <th className="text-right px-4 py-3 font-medium">Logged on WhatsApp</th>
                  <th className="text-right px-4 py-3 font-medium">Invoiced</th>
                  <th className="text-right px-4 py-3 font-medium">Difference</th>
                </tr>
              </thead>
              <tbody>
                {subbieRows.map((r) => {
                  const diff = r.invoiced - r.logged
                  const flag = r.invoiced > 0 && Math.abs(diff) >= 0.5
                  return (
                    <tr key={r.key} className="border-b border-gray-800/50 last:border-0">
                      <td className="px-4 py-3">
                        {r.name}
                        {!r.linked && <span className="block text-xs text-yellow-400">Not matched to a subbie — add them on the Workers page</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{hrs(r.logged)}</td>
                      <td className="px-4 py-3 text-right font-mono">{r.invoiced ? hrs(r.invoiced) : 'Not yet'}</td>
                      <td className={`px-4 py-3 text-right font-mono ${flag ? (diff > 0 ? 'text-red-400' : 'text-yellow-400') : 'text-green-400'}`}>
                        {r.invoiced ? (flag ? `${diff > 0 ? '+' : ''}${hrs(diff)}` : 'Matches') : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="text-xs text-gray-500 px-4 py-2 border-t border-gray-800">
              Red = invoiced more hours than logged on WhatsApp. Yellow = invoiced fewer.
            </p>
          </div>
        )}
      </section>

      {/* Variations */}
      <section>
        <SectionTitle>Variations</SectionTitle>
        <div className="space-y-3">
          {(variations ?? []).map((v) => (
            <div key={v.id} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span className="flex-1 min-w-48">{v.description}</span>
              <span className="text-gray-300">+{money(Number(v.amount))} income</span>
              <span className="text-gray-300">+{hrs(Number(v.hours))}</span>
              <span className="text-gray-300">+{money(Number(v.materials))} materials</span>
              <form action={deleteVariation.bind(null, id, v.id)}>
                <button className="text-gray-500 hover:text-red-400">Remove</button>
              </form>
            </div>
          ))}
          <Card>
            <form action={addVariation.bind(null, id)} className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
              <label className="col-span-2 text-sm">
                <span className="text-gray-300">Variation</span>
                <input name="description" required placeholder="e.g. Paint extra bedroom" className={`${inputClass} mt-1`} />
              </label>
              <label className="text-sm">
                <span className="text-gray-300">Extra charge ($)</span>
                <input name="amount" inputMode="decimal" placeholder="0" className={`${inputClass} mt-1`} />
              </label>
              <label className="text-sm">
                <span className="text-gray-300">Extra hours</span>
                <input name="hours" inputMode="decimal" placeholder="0" className={`${inputClass} mt-1`} />
              </label>
              <label className="text-sm">
                <span className="text-gray-300">Extra materials ($)</span>
                <input name="materials" inputMode="decimal" placeholder="0" className={`${inputClass} mt-1`} />
              </label>
              <button className={`${buttonClass} col-span-2 md:col-span-5`}>Add variation — budget updates automatically</button>
            </form>
          </Card>
        </div>
      </section>

      {/* Labour log */}
      <section>
        <SectionTitle>Labour log</SectionTitle>
        {!entries.length ? (
          <Empty>No clock-ins yet. Workers sign in on WhatsApp and pick this job from the list.</Empty>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="text-left px-4 py-3 font-medium">Worker</th>
                  <th className="text-left px-4 py-3 font-medium">Start</th>
                  <th className="text-left px-4 py-3 font-medium">End</th>
                  <th className="text-right px-4 py-3 font-medium">Hours</th>
                </tr>
              </thead>
              <tbody>
                {entries.slice(0, 50).map((e) => (
                  <tr key={e.id} className="border-b border-gray-800/50 last:border-0">
                    <td className="px-4 py-3">{e.workers?.name ?? '—'}{e.workers?.type === 'subbie' && <span className="text-gray-500"> (subbie)</span>}</td>
                    <td className="px-4 py-3 text-gray-300">{fmtDateTime(e.start_time)}</td>
                    <td className="px-4 py-3 text-gray-300">{e.end_time ? fmtDateTime(e.end_time) : <span className="text-green-400">On site now</span>}</td>
                    <td className="px-4 py-3 text-right font-mono">{hrs(entryHours(e))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Invoices */}
      <section>
        <SectionTitle right={<Link href="/inbox" className="text-sm text-blue-400 hover:underline">Upload or check invoices →</Link>}>
          Materials &amp; subbie invoices
        </SectionTitle>
        {!expenses.length ? (
          <Empty>No invoices yet. They arrive from the business email each morning, or upload one on the Invoices page.</Empty>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="text-left px-4 py-3 font-medium">From</th>
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Type</th>
                  <th className="text-right px-4 py-3 font-medium">Hours</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((x) => (
                  <tr key={x.id} className={`border-b border-gray-800/50 last:border-0 ${x.status === 'rejected' ? 'opacity-40 line-through' : ''}`}>
                    <td className="px-4 py-3">
                      {x.supplier ?? '—'}
                      {x.status === 'pending' && <span className="ml-2 text-xs text-yellow-400">needs checking</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-300">{fmtDate(x.expense_date)}</td>
                    <td className="px-4 py-3"><span className="text-xs bg-gray-800 px-2 py-0.5 rounded">{x.category}</span></td>
                    <td className="px-4 py-3 text-right font-mono">{x.hours ? hrs(Number(x.hours)) : ''}</td>
                    <td className="px-4 py-3 text-right font-mono">{money(Number(x.total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Edit */}
      <details className="bg-gray-900 border border-gray-800 rounded-xl">
        <summary className="px-5 py-4 cursor-pointer font-semibold">Edit job details</summary>
        <form action={updateJob.bind(null, id)} className="grid md:grid-cols-2 gap-3 px-5 pb-5">
          <Field label="Job code (changing it affects how new invoices match)" name="code" defaultValue={j.code} />
          <Field label="Client" name="client_name" defaultValue={j.client_name} />
          <Field label="Address" name="address" defaultValue={j.address} />
          <Field label="Quote total ($)" name="quote_total" defaultValue={j.quote_total} />
          <Field label="Quoted labour hours" name="quoted_hours" defaultValue={j.quoted_hours} />
          <Field label="Quoted materials ($)" name="quoted_materials" defaultValue={j.quoted_materials} />
          <div />
          <Field label="Start date" name="start_date" type="date" defaultValue={j.start_date} />
          <Field label="Finish date" name="planned_finish" type="date" defaultValue={j.planned_finish} />
          <button className={`${buttonClass} md:col-span-2`}>Save changes</button>
        </form>
      </details>
    </div>
  )
}

function Field({ label, name, defaultValue, type = 'text' }: { label: string; name: string; defaultValue: string | number | null; type?: string }) {
  return (
    <label className="text-sm">
      <span className="text-gray-300">{label}</span>
      <input type={type} name={name} defaultValue={defaultValue ?? ''} className={`${inputClass} mt-1`} />
    </label>
  )
}
