import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase'
import { emailConfigured } from '@/lib/email'
import { fmtDate, fmtDateTime, hrs, money } from '@/lib/format'
import { Card, Empty, SectionTitle, buttonClass, dangerButtonClass, inputClass } from '@/components/ui'
import { approveExpense, rejectExpense } from './actions'
import { CheckEmailButton, UploadInvoiceForm } from './forms'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Expense = {
  id: string; job_id: string | null; supplier: string | null; supplier_abn: string | null; invoice_number: string | null
  total: number; gst: number | null; amount_ex_gst: number; is_credit: boolean; note: string | null; submitted_by: string | null
  expense_date: string | null; category: string; status: string; hours: number | null; worker_id: string | null
  job_code_raw: string | null; confidence: string | null; source: string; file_name: string | null
  image_path: string | null; created_at: string; jobs: { code: string; client_name: string | null } | null
}

export default async function InboxPage() {
  const supabase = createServiceClient()
  const [{ data: pendingData }, { data: recentData }, { data: jobs }, { data: subbies }, { data: lastEmail }] = await Promise.all([
    supabase.from('expenses').select('*, jobs(code, client_name)').eq('status', 'pending').order('created_at', { ascending: false }),
    supabase.from('expenses').select('*, jobs(code, client_name)').neq('status', 'pending').order('created_at', { ascending: false }).limit(20),
    supabase.from('jobs').select('id, code, client_name, status').in('status', ['active', 'quoted', 'complete']).order('created_at', { ascending: false }),
    supabase.from('workers').select('id, name').eq('type', 'subbie').eq('active', true).order('name'),
    supabase.from('processed_emails').select('processed_at').order('processed_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const pending = (pendingData ?? []) as Expense[]
  const recent = (recentData ?? []) as Expense[]
  const connected = emailConfigured()

  const fileUrls = new Map<string, string>()
  const paths = [...pending, ...recent].map((x) => x.image_path).filter((p): p is string => !!p)
  if (paths.length) {
    const { data } = await supabase.storage.from('invoices').createSignedUrls(paths, 3600)
    for (const d of data ?? []) if (d.path && d.signedUrl) fileUrls.set(d.path, d.signedUrl)
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Invoices</h1>
        <p className="text-gray-400 text-sm mt-1">
          Supplier and subbie invoices are read from the receipts email every morning, and workers can send receipt photos to the WhatsApp bot. All costs are counted ex GST; credit notes and returns reduce the job&apos;s cost; repeats are caught.
          Anything the app isn&apos;t sure about waits here for you.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <h2 className="font-semibold mb-1">Business email</h2>
          {connected ? (
            <p className="text-sm text-gray-400 mb-3">
              Connected: <span className="text-gray-200">{process.env.IMAP_USER}</span>. Checked every morning at 7am.
              {lastEmail && <> Last email read {fmtDateTime(lastEmail.processed_at)}.</>}
            </p>
          ) : (
            <p className="text-sm text-yellow-400 mb-3">Not connected yet. Once it is, invoices arrive here automatically each morning.</p>
          )}
          <CheckEmailButton connected={connected} />
        </Card>
        <Card>
          <h2 className="font-semibold mb-3">Upload an invoice yourself</h2>
          <UploadInvoiceForm jobs={jobs ?? []} />
        </Card>
      </div>

      <section>
        <SectionTitle>Check these ({pending.length})</SectionTitle>
        {!pending.length ? (
          <Empty>Nothing to check. 👍</Empty>
        ) : (
          <div className="space-y-4">
            {pending.map((x) => {
              const url = x.image_path ? fileUrls.get(x.image_path) : null
              const reasons = [
                !x.job_id && (x.job_code_raw ? `job code "${x.job_code_raw}" not found` : 'no job code on it'),
                x.category === 'subbie' && !x.worker_id && 'subbie not recognised',
                x.category === 'subbie' && x.hours == null && 'no hours found',
                x.confidence === 'low' && 'hard to read',
                x.note,
              ].filter(Boolean)
              return (
                <Card key={x.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                    <div>
                      <span className="font-semibold">{x.supplier ?? 'Unknown supplier'}</span>
                      <span className="text-gray-400 text-sm">
                        {' '}· {fmtDate(x.expense_date)}{x.invoice_number && ` · #${x.invoice_number}`} · from {x.source === 'whatsapp' ? 'a worker on WhatsApp' : x.source}
                      </span>
                    </div>
                    {url && <a href={url} target="_blank" className="text-sm text-blue-400 hover:underline">Open {x.file_name ?? 'file'}</a>}
                  </div>
                  {reasons.length > 0 && <p className="text-sm text-yellow-400 mb-3">Needs you because: {reasons.join(', ')}.</p>}
                  <form action={approveExpense.bind(null, x.id)} className="grid grid-cols-2 md:grid-cols-7 gap-3 items-end">
                    <label className="col-span-2 text-sm">
                      <span className="text-gray-300">Job</span>
                      <select name="job_id" required defaultValue={x.job_id ?? ''} className={`${inputClass} mt-1`}>
                        <option value="" disabled>Choose job…</option>
                        {(jobs ?? []).map((j) => <option key={j.id} value={j.id}>{j.code} — {j.client_name ?? 'Unnamed'}</option>)}
                      </select>
                    </label>
                    <label className="text-sm">
                      <span className="text-gray-300">Type</span>
                      <select name="category" defaultValue={x.category} className={`${inputClass} mt-1`}>
                        <option value="materials">Materials</option>
                        <option value="subbie">Subbie</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="text-sm">
                      <span className="text-gray-300">Total incl GST ($){x.is_credit && ' — credit'}</span>
                      <input name="total" defaultValue={x.total} inputMode="decimal" className={`${inputClass} mt-1`} />
                    </label>
                    <label className="text-sm">
                      <span className="text-gray-300">GST ($)</span>
                      <input name="gst" defaultValue={x.gst ?? ''} inputMode="decimal" placeholder="0" className={`${inputClass} mt-1`} />
                    </label>
                    <label className="text-sm">
                      <span className="text-gray-300">Subbie</span>
                      <select name="worker_id" defaultValue={x.worker_id ?? ''} className={`${inputClass} mt-1`}>
                        <option value="">—</option>
                        {(subbies ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </label>
                    <label className="text-sm">
                      <span className="text-gray-300">Hours</span>
                      <input name="hours" defaultValue={x.hours ?? ''} inputMode="decimal" className={`${inputClass} mt-1`} />
                    </label>
                    <div className="col-span-2 md:col-span-7 flex gap-2">
                      <button className={buttonClass}>Save &amp; add to job</button>
                      <button formAction={rejectExpense.bind(null, x.id)} formNoValidate className={dangerButtonClass}>Not a job cost — ignore</button>
                    </div>
                  </form>
                  {x.category === 'subbie' && !(subbies ?? []).length && (
                    <p className="text-xs text-gray-500 mt-2">
                      Add your subbies on the <Link href="/workers" className="text-blue-400 hover:underline">Workers page</Link> so their invoices match automatically.
                    </p>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>Recently handled</SectionTitle>
        {!recent.length ? (
          <Empty>No invoices yet.</Empty>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="text-left px-4 py-3 font-medium">From</th>
                  <th className="text-left px-4 py-3 font-medium">Job</th>
                  <th className="text-left px-4 py-3 font-medium">Type</th>
                  <th className="text-right px-4 py-3 font-medium">Hours</th>
                  <th className="text-right px-4 py-3 font-medium">Amount ex GST</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((x) => {
                  const url = x.image_path ? fileUrls.get(x.image_path) : null
                  return (
                    <tr key={x.id} className={`border-b border-gray-800/50 last:border-0 ${x.status === 'rejected' ? 'opacity-40' : ''}`}>
                      <td className="px-4 py-3">
                        {url ? <a href={url} target="_blank" className="hover:underline">{x.supplier ?? '—'}</a> : x.supplier ?? '—'}
                        {x.status === 'rejected' && <span className="text-xs text-gray-500"> (ignored)</span>}
                      </td>
                      <td className="px-4 py-3">
                        {x.job_id && x.jobs ? <Link href={`/jobs/${x.job_id}`} className="text-blue-400 font-mono">{x.jobs.code}</Link> : '—'}
                      </td>
                      <td className="px-4 py-3"><span className="text-xs bg-gray-800 px-2 py-0.5 rounded">{x.category}</span></td>
                      <td className="px-4 py-3 text-right font-mono">{x.hours ? hrs(Number(x.hours)) : ''}</td>
                      <td className={`px-4 py-3 text-right font-mono ${x.is_credit ? 'text-green-400' : ''}`}>
                        {money(Number(x.amount_ex_gst))}{x.is_credit && ' credit'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
