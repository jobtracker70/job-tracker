import { moneyCents } from '@/lib/format'
import { fmtQty, itemsOf } from '@/lib/items'

// The lines on one invoice: what was bought, how many, and the price
export function InvoiceItems({ items, compact = false }: { items: unknown; compact?: boolean }) {
  const list = itemsOf(items)
  if (!list.length) return <p className="text-sm text-faint">No item list for this invoice.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        {!compact && (
          <thead>
            <tr className="text-muted border-b border-line">
              <th className="text-left font-medium py-2 pr-3">Item</th>
              <th className="text-right font-medium py-2 pr-3">Qty</th>
              <th className="text-right font-medium py-2 pr-3">Each</th>
              <th className="text-right font-medium py-2">Amount</th>
            </tr>
          </thead>
        )}
        <tbody>
          {list.map((i, k) => (
            <tr key={k} className="border-b border-line last:border-0 align-top">
              <td className="py-2 pr-3">{i.description}</td>
              <td className="py-2 pr-3 text-right whitespace-nowrap">{compact ? `× ${fmtQty(i.qty ?? 1)}` : fmtQty(i.qty)}</td>
              {!compact && <td className="py-2 pr-3 text-right whitespace-nowrap text-muted">{i.unit_price == null ? '—' : moneyCents(i.unit_price)}</td>}
              <td className="py-2 text-right whitespace-nowrap font-medium">{i.amount == null ? '—' : moneyCents(i.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-faint mt-2">Prices as printed on the invoice.</p>
    </div>
  )
}
