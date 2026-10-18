import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '@/lib/db'
import { loadJob } from '@/lib/job-data'
import { jobTitle } from '@/lib/status'
import { fmtDate, hrs, money, moneyCents } from '@/lib/format'
import { fmtQty, itemsOf, totalItems } from '@/lib/items'
import { SmallTag, cardClass } from '@/components/ui'
import { InvoiceItems } from '@/components/invoice-items'
import { UploadInvoiceForm } from '../../../inbox/forms'

export const dynamic = 'force-dynamic'

export default async function JobInvoicesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { db } = await getDb()
  const data = await loadJob(db, id)
  if (!data) notFound()
  const { j, expenses } = data

  const counted = expenses.filter((x) => x.status !== 'rejected')
  const materials = counted.filter((x) => x.category !== 'subbie')
  const subbies = counted.filter((x) => x.category === 'subbie')
  const sum = (list: typeof counted) => list.reduce((s, x) => s + Number(x.amount_ex_gst), 0)
  const bought = totalItems(materials)
  const missingItems = materials.filter((x) => !itemsOf(x.line_items).length).length

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/jobs/${id}`} className="text-brand text-sm font-medium hover:underline">← {jobTitle(j)}</Link>
        <h1 className="text-[26px] md:text-[32px] font-bold leading-tight mt-1">Invoices for this job</h1>
        <p className="text-muted">{counted.length} invoice{counted.length === 1 ? '' : 's'} · {money(sum(counted))} ex GST</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Tile label="Materials" value={money(sum(materials))} />
        <Tile label="Subbies" value={money(sum(subbies))} />
        <Tile label="Materials budget" value={data.nums.materialsBudget == null ? '—' : money(data.nums.materialsBudget)} />
      </div>

      <section>
        <h2 className="text-lg font-bold mb-3">Everything bought for this job</h2>
        <div className={`${cardClass} p-5`}>
          {!bought.length ? (
            <p className="text-sm text-muted">No item lists yet. New invoices are read line by line automatically.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted border-b border-line">
                    <th className="text-left font-medium py-2 pr-3">Item</th>
                    <th className="text-right font-medium py-2 pr-3">Total qty</th>
                    <th className="text-right font-medium py-2">Spent</th>
                  </tr>
                </thead>
                <tbody>
                  {bought.map((b) => (
                    <tr key={b.description} className="border-b border-line last:border-0 align-top">
                      <td className="py-2 pr-3">
                        {b.description}
                        {b.times > 1 && <span className="text-faint"> · on {b.times} invoices</span>}
                      </td>
                      <td className={`py-2 pr-3 text-right font-semibold ${b.qty < 0 ? 'text-good' : ''}`}>{fmtQty(b.qty)}</td>
                      <td className={`py-2 text-right whitespace-nowrap ${b.amount < 0 ? 'text-good' : ''}`}>{moneyCents(b.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-faint mt-2">
                Returns are taken off. Prices as printed on the invoices.
                {missingItems > 0 && ` ${missingItems} invoice${missingItems > 1 ? 's have' : ' has'} no item list.`}
              </p>
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-bold">Each invoice</h2>
          <details id="upload" className="group relative">
            <summary className="text-brand text-sm font-semibold cursor-pointer">⇪ Upload invoice for this job</summary>
            <div className={`${cardClass} absolute right-0 z-10 mt-2 w-[min(92vw,360px)] p-4`}>
              <UploadInvoiceForm jobs={[]} jobId={id} />
            </div>
          </details>
        </div>
        {!expenses.length ? (
          <div className={`${cardClass} p-8 text-center text-muted`}>No invoices on this job yet.</div>
        ) : (
          <div className="space-y-3">
            {expenses.map((x) => (
              <details key={x.id} className={`${cardClass} group ${x.status === 'rejected' ? 'opacity-50' : ''}`}>
                <summary className="flex items-center justify-between gap-3 px-4 py-3.5 cursor-pointer">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold">{x.supplier ?? 'Unknown'}</span>
                      {x.status === 'pending' && <SmallTag tone="warn">needs checking</SmallTag>}
                      {x.status === 'rejected' && <SmallTag>ignored</SmallTag>}
                      {x.source === 'whatsapp' && <SmallTag>photo</SmallTag>}
                      {x.category === 'subbie' && <SmallTag>subbie</SmallTag>}
                      {x.is_credit && <SmallTag tone="good">credit</SmallTag>}
                    </span>
                    <span className="block text-sm text-muted">
                      {fmtDate(x.expense_date)}{x.invoice_number ? ` · #${x.invoice_number}` : ''}
                      {x.hours ? ` · ${hrs(Number(x.hours))}` : ''}
                      {itemsOf(x.line_items).length ? ` · ${itemsOf(x.line_items).length} item${itemsOf(x.line_items).length > 1 ? 's' : ''}` : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className={`font-semibold ${x.is_credit ? 'text-good' : ''}`}>{moneyCents(Number(x.amount_ex_gst))}</span>
                    <span className="text-faint text-xl transition group-open:rotate-90">›</span>
                  </span>
                </summary>
                <div className="mx-3 mb-3 rounded-xl bg-page/70 border border-line p-3">
                  <InvoiceItems items={x.line_items} />
                  <Link href={`/inbox/${x.id}`} className="inline-block mt-2 text-brand text-sm font-semibold">Open invoice →</Link>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${cardClass} p-4`}>
      <p className="text-xl font-bold">{value}</p>
      <p className="text-muted text-sm">{label}</p>
    </div>
  )
}
