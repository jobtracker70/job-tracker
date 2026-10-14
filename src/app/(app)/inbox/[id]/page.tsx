import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase'
import { fmtDate, fmtDateTime, hrs, moneyCents } from '@/lib/format'
import { Pill, SmallTag, cardClass, secondaryButtonClass } from '@/components/ui'
import { InvoiceItems } from '@/components/invoice-items'

export const dynamic = 'force-dynamic'

const SOURCE: Record<string, string> = { email: 'Receipts email', whatsapp: 'Photo from a worker', upload: 'Uploaded' }

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServiceClient()
  const { data: x } = await supabase
    .from('expenses')
    .select('*, jobs(id, code, address), workers!expenses_submitted_by_fkey(name)')
    .eq('id', id)
    .maybeSingle()
  if (!x) notFound()

  const job = x.jobs as { id: string; code: string; address: string | null } | null
  const sender = (x.workers as { name: string } | null)?.name
  const fileUrl = x.image_path ? (await supabase.storage.from('invoices').createSignedUrl(x.image_path, 3600)).data?.signedUrl : null
  const status = x.status === 'pending' ? { tone: 'warn' as const, label: 'Needs checking' } : x.status === 'rejected' ? { tone: 'neutral' as const, label: 'Ignored' } : { tone: 'good' as const, label: 'Added to job' }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <Link href={job ? `/jobs/${job.id}/invoices` : '/inbox'} className="text-brand text-sm font-medium hover:underline">
          ← {job ? `${job.address ?? job.code} invoices` : 'Invoices'}
        </Link>
        <div className="flex items-start justify-between gap-3 mt-1">
          <div className="min-w-0">
            <h1 className="text-[26px] md:text-[32px] font-bold leading-tight">{x.supplier ?? 'Unknown supplier'}</h1>
            <p className="text-muted">
              {fmtDate(x.expense_date)}{x.invoice_number ? ` · Invoice #${x.invoice_number}` : ''}
            </p>
          </div>
          <Pill tone={status.tone}>{status.label}</Pill>
        </div>
      </div>

      <div className={`${cardClass} p-5 grid grid-cols-2 sm:grid-cols-3 gap-4`}>
        <Info label="Cost to the job (ex GST)" value={<span className={`text-xl font-bold ${x.is_credit ? 'text-good' : ''}`}>{moneyCents(Number(x.amount_ex_gst))}</span>} />
        <Info label="Total incl GST" value={moneyCents(Number(x.total))} />
        <Info label="GST" value={x.gst == null ? '—' : moneyCents(Number(x.gst))} />
        <Info label="Job" value={job ? <Link href={`/jobs/${job.id}`} className="text-brand font-semibold">{job.address ?? job.code}</Link> : 'Not on a job yet'} />
        <Info label="Came from" value={`${SOURCE[x.source] ?? x.source}${sender ? ` (${sender})` : ''}`} />
        <Info label="Received" value={fmtDateTime(x.created_at)} />
        {x.category === 'subbie' && <Info label="Subbie hours invoiced" value={x.hours == null ? '—' : hrs(Number(x.hours))} />}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {x.is_credit && <SmallTag tone="good">credit / return</SmallTag>}
        {x.category === 'subbie' && <SmallTag>subbie</SmallTag>}
        {x.category === 'other' && <SmallTag>other</SmallTag>}
        {x.note && <SmallTag tone="warn">{x.note}</SmallTag>}
      </div>

      <section>
        <h2 className="text-lg font-bold mb-3">What was bought</h2>
        <div className={`${cardClass} p-5`}>
          <InvoiceItems items={x.line_items} />
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        {fileUrl && <a href={fileUrl} target="_blank" className={secondaryButtonClass}>Open the original invoice</a>}
        {x.status === 'pending' && <Link href="/inbox" className={secondaryButtonClass}>Check it on the Invoices page</Link>}
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <div className="font-medium mt-0.5 break-words">{value}</div>
    </div>
  )
}
