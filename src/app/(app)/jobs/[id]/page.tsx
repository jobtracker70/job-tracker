import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isSubbieType, loadJob, peopleOnJob } from '@/lib/job-data'
import { FINISHED, jobPill, jobSentence, jobSubtitle, jobTitle } from '@/lib/status'
import { fmtDate, fmtTimeOfDay, hrs, money, moneyCents, timeToMinutes, todaySydney } from '@/lib/format'
import {
  AlertBar, Collapsible, Pill, ProgressBar, SmallTag,
  buttonClass, cardClass, dangerButtonClass, inputClass, secondaryButtonClass,
} from '@/components/ui'
import { ConfirmButton } from '@/components/confirm-button'
import { acceptQuote, addVariation, deleteVariation, rejectQuote, setJobStatus, updateJob } from './actions'

export const dynamic = 'force-dynamic'

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ codeError?: string }> }) {
  const { id } = await params
  const { codeError } = await searchParams
  const data = await loadJob(id)
  if (!data) notFound()
  const { j, job, entries, expenses, variations, subbieRows, nums, f, supabase } = data

  const pill = jobPill(j, f)
  const pdfUrl = job.quote_pdf_path
    ? (await supabase.storage.from('quotes').createSignedUrl(job.quote_pdf_path, 3600)).data?.signedUrl
    : null
  const finished = FINISHED.includes(j.status)

  const peopleRows = peopleOnJob(entries)
  const people = peopleRows.length
  const checkCount = entries.filter((e) => e.needs_review).length
  const counted = expenses.filter((x) => x.status !== 'rejected')
  const invoicesTotal = counted.reduce((s, x) => s + Number(x.amount_ex_gst), 0)
  const subbieMismatch = subbieRows.some((r) => !r.fixed && r.invoiced > 0 && Math.abs(r.invoiced - r.logged) >= 0.5)

  const editForm = (
    <form action={updateJob.bind(null, id)} className="grid sm:grid-cols-2 gap-3">
      <Field label="Job code" name="code" defaultValue={j.code} />
      <Field label="Client" name="client_name" defaultValue={j.client_name} />
      <div className="sm:col-span-2"><Field label="Address" name="address" defaultValue={j.address} /></div>
      <Field label="Quote total ($ ex GST)" name="quote_total" defaultValue={j.quote_total} />
      <Field label="Quoted labour hours" name="quoted_hours" defaultValue={j.quoted_hours} />
      <Field label="Quoted materials ($ ex GST)" name="quoted_materials" defaultValue={j.quoted_materials} />
      <div />
      <Field label="Start date" name="start_date" type="date" defaultValue={j.start_date} />
      <Field label="Finish date" name="planned_finish" type="date" defaultValue={j.planned_finish} />
      <TimeField label="Usual start time" name="day_start" value={job.day_start} />
      <TimeField label="Usual finish time" name="day_end" value={job.day_end} />
      <p className="sm:col-span-2 text-xs text-faint -mt-1">
        Signing in up to 30 minutes before the start counts from the start. Signing out up to 20 minutes after the finish counts as the finish; later than that, the worker is asked to confirm.
      </p>
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
        <button className={buttonClass}>Save changes</button>
        {pdfUrl && <a href={pdfUrl} target="_blank" className="text-brand text-sm font-medium hover:underline">Open quote PDF</a>}
      </div>
    </form>
  )

  return (
    <div className="space-y-5">
      <div>
        <Link href={j.status === 'quoted' ? '/?tab=quotes' : finished || j.status === 'rejected' ? '/?tab=finished' : '/'} className="text-brand text-sm font-medium hover:underline">← Jobs</Link>
        <div className="flex items-start justify-between gap-3 mt-1">
          <div className="min-w-0">
            <h1 className="text-[26px] md:text-[32px] font-bold leading-tight">{jobTitle(j)}</h1>
            <p className="text-muted">{jobSubtitle(j)}{job.po_ref && ` · PO ${job.po_ref}`}</p>
          </div>
          <Pill tone={pill.tone}>{pill.label}</Pill>
        </div>
      </div>

      {codeError && (
        <AlertBar>{codeError === 'used' ? 'That job code is already used by another job. Nothing was saved.' : 'Job codes are 2–24 letters, numbers or dashes. Nothing was saved.'}</AlertBar>
      )}
      {j.entries_to_review > 0 && (
        <AlertBar action={<Link href={`/hours?job=${id}`} className="bg-white rounded-xl px-3 py-1.5 text-sm font-semibold">Fix hours →</Link>}>
          {j.entries_to_review} shift{j.entries_to_review > 1 ? 's' : ''} need{j.entries_to_review > 1 ? '' : 's'} checking
        </AlertBar>
      )}

      {/* Waiting quote: decide */}
      {j.status === 'quoted' ? (
        <>
          <div className={`${cardClass} p-5 flex items-center justify-between`}>
            <span className="text-muted">Quote (ex GST)</span>
            <span className="text-2xl font-bold">{money(nums.income)}</span>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <form action={acceptQuote.bind(null, id)} className={`${cardClass} p-5 space-y-3`}>
              <h2 className="text-lg font-bold">Accept quote</h2>
              <Field label="Start date" name="start_date" type="date" defaultValue={todaySydney()} required />
              <Field label="Finish date (optional)" name="planned_finish" type="date" defaultValue={null} />
              <Field label="Painters on the job" name="crew_size" type="number" defaultValue={2} />
              <p className="text-faint text-xs">No finish date? It&apos;s worked out from the quoted hours ({hrs(j.quoted_hours)}).</p>
              <ConfirmButton
                label="Start job"
                question="Start this job? It moves to Active and workers can sign in to it on WhatsApp straight away."
                confirmLabel="Yes, start job"
                className={`${buttonClass} w-full`}
                tone="brand"
              />
            </form>
            <form action={rejectQuote.bind(null, id)} className={`${cardClass} p-5 space-y-3`}>
              <h2 className="text-lg font-bold">Reject quote</h2>
              <label className="block">
                <span className="text-sm font-medium">Why was it rejected?</span>
                <textarea name="reason" required rows={5} placeholder="e.g. Too expensive, went with another painter" className={`${inputClass} mt-1.5`} />
              </label>
              <button className={`${dangerButtonClass} w-full`}>Reject quote</button>
            </form>
          </div>
          <div className={cardClass}>
            <Collapsible title="Edit job details" summary="Code, client, address, quoted hours and materials">{editForm}</Collapsible>
          </div>
        </>
      ) : (
        <div className="grid md:grid-cols-2 gap-5 items-start">
          {/* Left: the answer */}
          <div className="space-y-4">
            <div className={`${cardClass} p-5`}>
              <div className="grid grid-cols-3 gap-3">
                <Money label="Income" value={nums.income} />
                <Money label={finished ? 'Costs' : 'Costs so far'} value={nums.costs} />
                <Money label="Profit" value={nums.profit} tone={nums.profit >= 0 ? 'good' : 'bad'} />
              </div>
              <p className="text-sm text-muted mt-4 pt-4 border-t border-line">
                Margin <strong className="text-ink">{nums.margin == null ? '—' : `${Math.round(nums.margin * 100)}%`}</strong>
                {!finished && ' so far'} · all ex GST
              </p>
            </div>

            <div className="bg-brand-tint border border-brand/15 rounded-2xl p-4 text-ink">{jobSentence(j, nums, f)}</div>

            <div className={`${cardClass} p-5 space-y-4`}>
              <ProgressBar label="Hours" used={nums.hoursUsed} budget={nums.hoursBudget} format={hrs} />
              <ProgressBar label="Materials" used={nums.materialsCost} budget={nums.materialsBudget} format={money} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Link href={`/jobs/${id}/report`} className={secondaryButtonClass}>Job report</Link>
              {j.status === 'active' && (
                <form action={setJobStatus.bind(null, id, 'complete')}><button className={`${buttonClass} w-full`}>Mark finished</button></form>
              )}
              {finished && (
                <form action={setJobStatus.bind(null, id, 'active')}><button className={`${secondaryButtonClass} w-full`}>Reopen job</button></form>
              )}
              {j.status === 'rejected' && (
                <form action={setJobStatus.bind(null, id, 'quoted')}><button className={`${secondaryButtonClass} w-full`}>Move back to quotes</button></form>
              )}
            </div>
          </div>

          {/* Right: details on tap */}
          <div className={cardClass}>
            <Collapsible title="Hours worked" summary={entries.length ? `${people} ${people === 1 ? 'person' : 'people'}, ${hrs(nums.hoursUsed)}` : 'No sign-ins yet'}>
              {!entries.length ? (
                <p className="text-sm text-muted py-1">Workers sign in on WhatsApp and pick this job.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {peopleRows.map((p) => (
                    <li key={p.workerId}>
                      <Link href={`/jobs/${id}/people/${p.workerId}`} className="py-2.5 flex items-center justify-between gap-3 text-sm hover:text-brand">
                        <span className="min-w-0">
                          <span className="font-semibold">{p.name}</span>
                          {isSubbieType(p.type) && <span className="ml-1.5"><SmallTag>subbie</SmallTag></span>}
                          <span className="block text-muted">{p.days} day{p.days === 1 ? '' : 's'} · {p.weeks.length} week{p.weeks.length === 1 ? '' : 's'}</span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="text-right">
                            <span className="font-semibold block">{hrs(p.hours)}</span>
                            <span className="text-faint">{isSubbieType(p.type) ? 'invoice' : money(p.cost)}</span>
                          </span>
                          <span className="text-faint">›</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 mb-1 text-sm font-semibold">
                <Link href={`/hours?job=${id}`} className="text-brand">See every shift{checkCount ? ` (${checkCount} to check)` : ''} →</Link>
              </div>
            </Collapsible>

            <Collapsible title="Invoices" summary={counted.length ? `${counted.length} invoice${counted.length > 1 ? 's' : ''}, ${money(invoicesTotal)}` : 'No invoices yet'}>
              {!expenses.length ? (
                <p className="text-sm text-muted py-1">They arrive from the receipts email, from workers&apos; WhatsApp photos, or you can upload one.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {expenses.slice(0, 8).map((x) => (
                    <li key={x.id} className={x.status === 'rejected' ? 'opacity-40 line-through' : ''}>
                      <Link href={`/inbox/${x.id}`} className="py-2.5 flex items-center justify-between gap-3 text-sm hover:text-brand">
                        <span className="min-w-0">
                          <span className="font-semibold">{x.supplier ?? 'Unknown'}</span>
                          <span className="block text-muted">{fmtDate(x.expense_date)}{x.hours ? ` · ${hrs(Number(x.hours))}` : ''}</span>
                          <span className="flex flex-wrap gap-1 mt-1">
                            {x.status === 'pending' && <SmallTag tone="warn">needs checking</SmallTag>}
                            {x.source === 'whatsapp' && <SmallTag>photo</SmallTag>}
                            {x.category === 'subbie' && <SmallTag>subbie</SmallTag>}
                            {x.is_credit && <SmallTag tone="good">credit</SmallTag>}
                          </span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className={`text-right font-semibold ${x.is_credit ? 'text-good' : ''}`}>
                            {moneyCents(Number(x.amount_ex_gst))}
                            <span className="block text-faint text-xs font-normal">ex GST</span>
                          </span>
                          <span className="text-faint">›</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {expenses.length > 8 && <p className="text-xs text-faint mt-1">Showing the newest 8 of {expenses.length}.</p>}
              <div className="grid grid-cols-2 gap-2 mt-2 mb-1">
                <Link href={`/jobs/${id}/invoices`} className={secondaryButtonClass}>Everything bought</Link>
                <Link href={`/jobs/${id}/invoices#upload`} className={secondaryButtonClass}>Upload invoice</Link>
              </div>
            </Collapsible>

            <Collapsible
              title="Subbies"
              summary={!subbieRows.length ? 'No subbies yet' : `${subbieRows.length} subbie${subbieRows.length > 1 ? 's' : ''}, ${subbieMismatch ? 'hours don’t match' : 'hours match ✓'}`}
              summaryTone={subbieMismatch ? 'bad' : subbieRows.length ? 'good' : undefined}
            >
              {!subbieRows.length ? (
                <p className="text-sm text-muted">Subbie sign-ins and invoices show here.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {subbieRows.map((r) => {
                    const diff = r.invoiced - r.logged
                    const flag = !r.fixed && r.invoiced > 0 && Math.abs(diff) >= 0.5
                    return (
                      <li key={r.key} className="py-2.5 text-sm">
                        <div className="flex justify-between gap-3">
                          <span className="font-semibold">{r.name}</span>
                          <span className={r.fixed ? 'text-faint' : flag ? (diff > 0 ? 'text-bad font-semibold' : 'text-warn font-semibold') : 'text-good font-semibold'}>
                            {r.fixed ? 'Fixed price' : !r.invoiced ? 'Not invoiced yet' : flag ? `${diff > 0 ? '+' : ''}${hrs(diff)}` : 'Matches ✓'}
                          </span>
                        </div>
                        <p className="text-muted">
                          Signed in {hrs(r.logged)}{!r.fixed && r.invoiced ? ` · invoiced ${hrs(r.invoiced)}` : ''}{r.amount ? ` · ${money(r.amount)}` : ''}
                        </p>
                        {!r.linked && <p className="text-warn text-xs mt-0.5">Not matched to a subbie. Add them on the Workers page.</p>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </Collapsible>

            <Collapsible
              title="Extras"
              summary={variations.length ? `${variations.length} extra${variations.length > 1 ? 's' : ''}, +${money(Number(j.variations_total))}` : 'No extras added'}
            >
              {variations.length > 0 && (
                <ul className="divide-y divide-line mb-3">
                  {variations.map((v) => (
                    <li key={v.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0">
                        <span className="font-semibold">{v.description}</span>
                        <span className="block text-muted">+{money(Number(v.amount))} · +{hrs(Number(v.hours))} · +{money(Number(v.materials))} materials</span>
                      </span>
                      <form action={deleteVariation.bind(null, id, v.id)}>
                        <ConfirmButton label="Remove" question={`Remove "${v.description}"?`} confirmLabel="Yes, remove" className="text-faint hover:text-bad text-sm" />
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              <form action={addVariation.bind(null, id)} className="grid grid-cols-3 gap-2">
                <input name="description" required placeholder="What extra work? e.g. Paint extra bedroom" className={`${inputClass} col-span-3`} />
                <input name="amount" inputMode="decimal" placeholder="Charge $" className={inputClass} />
                <input name="hours" inputMode="decimal" placeholder="Hours" className={inputClass} />
                <input name="materials" inputMode="decimal" placeholder="Materials $" className={inputClass} />
                <button className={`${buttonClass} col-span-3`}>Add extra</button>
              </form>
              <p className="text-faint text-xs mt-2">Amounts ex GST. The budget updates automatically.</p>
            </Collapsible>

            {j.status === 'active' && (
              <Collapsible title="More numbers" summary="Pace, projected hours and profit">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <Num label="Time gone" value={f.timePct == null ? '—' : `${Math.round(f.timePct * 100)}%`} />
                  <Num label="Hours used" value={f.hoursPct == null ? '—' : `${Math.round(f.hoursPct * 100)}%`} />
                  <Num label="Hours at finish (this pace)" value={f.projectedHours == null ? '—' : hrs(f.projectedHours)} />
                  <Num label="Projected profit" value={money(f.projectedProfit)} />
                  <Num label="Planned dates" value={`${fmtDate(j.start_date)} → ${fmtDate(j.planned_finish)}`} />
                  <Num label="Hours budget runs out" value={f.budgetRunsOut ? fmtDate(f.budgetRunsOut) : '—'} />
                </dl>
              </Collapsible>
            )}

            <Collapsible title="Edit job details" summary="Code, client, address, quoted hours and materials">{editForm}</Collapsible>
          </div>
        </div>
      )}
    </div>
  )
}

function Money({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-muted">{label}</p>
      <p className={`text-xl md:text-[26px] font-bold truncate ${tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : ''}`}>{money(value)}</p>
    </div>
  )
}

function Num({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  )
}

function Field({ label, name, defaultValue, type = 'text', required }: {
  label: string; name: string; defaultValue: string | number | null; type?: string; required?: boolean
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input type={type} name={name} required={required} defaultValue={defaultValue ?? ''} className={`${inputClass} mt-1.5`} />
    </label>
  )
}

const TIMES = Array.from({ length: (21 - 5) * 4 }, (_, i) => 5 * 60 + i * 15)

function TimeField({ label, name, value }: { label: string; name: string; value: string | null }) {
  const current = timeToMinutes(value, name === 'day_start' ? 7 * 60 : 15 * 60 + 30)
  const opts = TIMES.includes(current) ? TIMES : [...TIMES, current].sort((a, b) => a - b)
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <select name={name} defaultValue={hhmm(current)} className={`${inputClass} mt-1.5`}>
        {opts.map((m) => <option key={m} value={hhmm(m)}>{fmtTimeOfDay(hhmm(m))}</option>)}
      </select>
    </label>
  )
}
