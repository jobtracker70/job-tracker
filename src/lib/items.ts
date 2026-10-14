import type { LineItem } from './invoices'

export type { LineItem }

export const itemsOf = (v: unknown): LineItem[] => (Array.isArray(v) ? (v as LineItem[]) : [])

// Adds up the same product across invoices, e.g. "Dulux Wash&Wear 10L" bought on three receipts.
export function totalItems(invoices: { line_items: unknown; is_credit: boolean }[]) {
  const map = new Map<string, { description: string; qty: number; amount: number; times: number }>()
  for (const inv of invoices) {
    const sign = inv.is_credit ? -1 : 1
    for (const i of itemsOf(inv.line_items)) {
      const key = i.description.toLowerCase().replace(/\s+/g, ' ').trim()
      const r = map.get(key) ?? { description: i.description, qty: 0, amount: 0, times: 0 }
      r.qty += sign * Math.abs(Number(i.qty ?? 1))
      r.amount += sign * Math.abs(Number(i.amount ?? (i.unit_price != null ? i.unit_price * Number(i.qty ?? 1) : 0)))
      r.times++
      map.set(key, r)
    }
  }
  return [...map.values()].filter((r) => Math.abs(r.qty) > 0.001 || Math.abs(r.amount) > 0.001).sort((a, b) => b.amount - a.amount)
}

export const fmtQty = (n: number | null | undefined) => (n == null ? '—' : String(Math.round(n * 100) / 100))
