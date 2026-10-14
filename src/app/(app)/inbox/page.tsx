import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase'
import { emailConfigured } from '@/lib/email'
import { fmtDate, fmtDateTime, moneyCents as money } from '@/lib/format'
import { SmallTag, buttonClass, cardClass, inputClass, secondaryButtonClass } from '@/components/ui'
import { approveExpense, rejectExpense } from './actions'
import { CheckEmailButton, UploadInvoiceForm } from './forms'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Expense = {
  id: string; job_id: string | null; supplier: string | null; invoice_number: string | null
  total: number; gst: number | null; amount_ex_gst: number; is_credit: boolean; note: string | null
  expense_date: string | null; category: string; status: string; hours: number | null; worker_id: string | null
  job_code_raw: string | null; confidence: string | null; source: string; file_name: string | null
  image_path: string | null; created_at: string; jobs: { code: string; address: string | null } | null
}

// Why the app couldn't file this invoice by itself, in plain words
function reason(x: Expense) {
  if (x.note) return 'it might be a repeat of one already added'
  if (!x.job_id) return x.job_code_raw ? `job code "${x.job_code_raw}" doesn't match a job` : 'no job code on it'
  if (x.category === 'subbie' && !x.worker_id) return "the subbie isn't on your Workers list"
  if (x.category === 'subbie' && x.hours == null) return 'no hours on the subbie invoice'
  if (x.confidence === 'low') return 'it was hard to read'
  return 'please check it'
}

export default async function InboxPage() {
  const supabase = createServiceClient()
  const [{ data: pendingData }, { data: recentData }, { data: jobs }, { data: subbies }, { data: lastEmail }] = await Promise.all([
    supabase.from('expenses').select('*, jobs(code, address)').eq('status', 'pending').order('created_at', { ascending: false }),
    supabase.from('expenses').select('*, jobs(code, address)').neq('status', 'pending').order('created_at', { ascending: false }).limit(60),
    supabase.from('jobs').select('id, code, client_name, address, status').eq('status', 'active').order('created_at', { ascending: false }),
    supabase.from('workers').select('id, name').in('type', ['subbie', 'subbie_fixed']).eq('active', true).order('name'),
    supabase.from('processed_emails').select('processed_at').order('processed_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const pending = (pendingData ?? []) as Expense[]
  const recent = (recentData ?? []) as Expense[]
  const connected = emailConfigured()

  // Recently added, grouped by job (newest job activity first)
  const groups = new Map<string, { key: string; jobId: string | null; label: string; items: Expense[]; total: number }>()
  for (const x of recent) {
    const key = x.job_id ?? 'none'
    const g = groups.get(key) ?? { key, jobId: x.job_id, label: x.jobs?.address ?? x.jobs?.code ?? 'No job', items: [], total: 0 }
    g.items.push(x)
    if (x.status !== 'rejected') g.total += Number(x.amount_ex_gst)
    groups.set(key, g)
  }

  const fileUrls = new Map<string, string>()
  const paths = pending.map((x) => x.image_path).filter((p): p is string => !!p)
  if (paths.length) {
    const { data } = await supabase.storage.from('invoices').createSignedUrls(paths, 3600)
    for (const d of data ?? []) if (d.path && d.signedUrl) fileUrls.set(d.path, d.signedUrl)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[28px] md:text-[32px] font-bold leading-tight">Invoices</h1>
          <p className="text-muted text-sm mt-1">
            ✉{' '}
            {connected
              ? <>Receipts inbox connected{lastEmail && <>, last checked {fmtDateTime(lastEmail.processed_at)}</>}. <CheckEmailButton connected /></>
              : 'Receipts inbox not connected yet.'}
          </p>
        </div>
        <details className="group relative">
          <summary className={`${secondaryButtonClass} cursor-pointer`}>⇪ Upload invoice</summary>
          <div className={`${cardClass} absolute right-0 z-10 mt-2 w-[min(92vw,360px)] p-4`}>
            <UploadInvoiceForm jobs={jobs ?? []} />
          </div>
        </details>
      </div>

      <section>
        <h2 className="text-lg font-bold mb-3">Needs checking <span className="text-muted font-normal">({pending.length})</span></h2>
        {!pending.length ? (
          <div className="bg-good-tint border border-good/20 rounded-2xl px-4 py-3 text-good font-semibold">Nothing to check ✓</div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {pending.map((x) => {
              const url = x.image_path ? fileUrls.get(x.image_path) : null
              return (
                <form key={x.id} action={approveExpense.bind(null, x.id)} className={`${cardClass} border-l-4 !border-l-bad p-4 space-y-3`}>
                  <div>
                    <p><strong>{x.supplier ?? 'Unknown supplier'}</strong>, <strong>{money(Number(x.total))}</strong>, {reason(x)}. Which job?</p>
                    <p className="text-faint text-sm mt-0.5">
                      Received {fmtDate(x.created_at.slice(0, 10))}{x.source === 'whatsapp' ? ' · photo from a worker' : ''}
                      {url && <> · <a href={url} target="_blank" className="text-brand font-medium">Open file</a></>}
                      {' · '}<Link href={`/inbox/${x.id}`} className="text-brand font-medium">See items</Link>
                    </p>
                  </div>
                  <select name="job_id" required defaultValue={x.job_id ?? ''} className={inputClass}>
                    <option value="" disabled>Choose a job</option>
                    {(jobs ?? []).map((j) => <option key={j.id} value={j.id}>{j.address ?? j.client_name ?? j.code}</option>)}
                    {x.job_id && !(jobs ?? []).some((j) => j.id === x.job_id) && <option value={x.job_id}>{x.jobs?.address ?? x.jobs?.code ?? 'Current job'}</option>}
                  </select>
                  <details className="group">
                    <summary className="text-sm text-brand font-medium cursor-pointer">Edit details</summary>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <label className="block text-sm"><span className="font-medium">Type</span>
                        <select name="category" defaultValue={x.category} className={`${inputClass} mt-1`}>
                          <option value="materials">Materials</option>
                          <option value="subbie">Subbie</option>
                          <option value="other">Other</option>
                        </select></label>
                      <label className="block text-sm"><span className="font-medium">Total incl GST</span>
                        <input name="total" defaultValue={x.total} inputMode="decimal" className={`${inputClass} mt-1`} /></label>
                      <label className="block text-sm"><span className="font-medium">GST</span>
                        <input name="gst" defaultValue={x.gst ?? ''} inputMode="decimal" placeholder="0" className={`${inputClass} mt-1`} /></label>
                      <label className="block text-sm"><span className="font-medium">Subbie hours</span>
                        <input name="hours" defaultValue={x.hours ?? ''} inputMode="decimal" className={`${inputClass} mt-1`} /></label>
                      <label className="block text-sm col-span-2"><span className="font-medium">Subbie</span>
                        <select name="worker_id" defaultValue={x.worker_id ?? ''} className={`${inputClass} mt-1`}>
                          <option value="">—</option>
                          {(subbies ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select></label>
                    </div>
                    {x.category === 'subbie' && !(subbies ?? []).length && (
                      <p className="text-xs text-muted mt-2">Add your subbies on the <Link href="/workers" className="text-brand">Workers page</Link> so their invoices match.</p>
                    )}
                  </details>
                  <div className="grid grid-cols-2 gap-2">
                    <button className={buttonClass}>Add to job</button>
                    <button formAction={rejectExpense.bind(null, x.id)} formNoValidate className={secondaryButtonClass}>Ignore</button>
                  </div>
                </form>
              )
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-bold mb-3">Recently added</h2>
        {!recent.length ? (
          <div className={`${cardClass} p-8 text-center text-muted`}>No invoices yet.</div>
        ) : (
          <div className="space-y-4">
            {[...groups.values()].map((g) => (
              <div key={g.key} className={cardClass}>
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line bg-page/60 rounded-t-2xl">
                  <span className="min-w-0">
                    <span className="block font-bold truncate">{g.label}</span>
                    <span className="block text-xs text-muted">{g.items.length} invoice{g.items.length > 1 ? 's' : ''} · {money(g.total)} ex GST</span>
                  </span>
                  {g.jobId && <Link href={`/jobs/${g.jobId}/invoices`} className="text-brand text-sm font-semibold shrink-0">All for this job →</Link>}
                </div>
                <ul className="divide-y divide-line">
                  {g.items.map((x) => (
                    <li key={x.id} className={x.status === 'rejected' ? 'opacity-50' : ''}>
                      <Link href={`/inbox/${x.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-page/60">
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-sm">{x.supplier ?? 'Unknown'}</span>
                            {x.source === 'whatsapp' && <SmallTag>photo</SmallTag>}
                            {x.is_credit && <SmallTag tone="good">credit</SmallTag>}
                            {x.category === 'subbie' && <SmallTag>subbie</SmallTag>}
                            {x.status === 'rejected' && <SmallTag>ignored</SmallTag>}
                          </span>
                          <span className="block text-xs text-muted">{fmtDate(x.expense_date)}{x.invoice_number ? ` · #${x.invoice_number}` : ''}</span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className={`text-sm font-semibold ${x.is_credit ? 'text-good' : ''}`}>{money(Number(x.amount_ex_gst))}</span>
                          <span className="text-faint">›</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
