import type { BusinessDb } from './db'
import { itemValue, itemsOf } from './items'

const cents = (n: number) => Math.round(n * 100) / 100

// Moves some of an invoice's items to another job (or to "Needs checking" with jobId null). The moved items become
// their own row linked to the original. Total and GST move in proportion to the items' prices, so a delivery fee or
// discount that isn't its own line is shared fairly and the two parts always add up to the whole invoice.
export async function moveInvoiceItems(db: BusinessDb, expenseId: string, picked: number[], jobId: string | null) {
  const { data: x } = await db.from('expenses').select('*').eq('id', expenseId).maybeSingle()
  if (!x || x.status === 'rejected' || x.category === 'subbie' || jobId === x.job_id) return null

  const items = itemsOf(x.line_items)
  const canMove = (k: number) => picked.includes(k) && itemValue(items[k]) != null
  const moving = items.filter((_, k) => canMove(k))
  const staying = items.filter((_, k) => !canMove(k))
  if (!moving.length) return null

  // Every item picked: the whole invoice moves, nothing to split
  if (!staying.length) {
    const { error } = await db.from('expenses').update({ job_id: jobId, status: jobId ? 'approved' : 'pending' }).eq('id', expenseId)
    if (error) throw new Error(error.message)
    return expenseId
  }

  const sum = (list: typeof items) => list.reduce((s, i) => s + (itemValue(i) ?? 0), 0)
  const priced = sum(items)
  const share = priced ? sum(moving) / priced : 0
  if (share < 0 || share > 1) return null

  const total = Number(x.total)
  const gst = x.gst == null ? null : Number(x.gst)
  const movedTotal = cents(total * share)
  const movedGst = gst == null ? null : cents(gst * share)
  const original_total = x.original_total ?? x.total

  // Only if the invoice hasn't changed since it was read, so a double tap can't move the same items twice
  const { data: updated, error } = await db
    .from('expenses')
    .update({ line_items: staying, total: cents(total - movedTotal), gst: gst == null ? null : cents(gst - (movedGst ?? 0)), original_total })
    .eq('id', expenseId)
    .eq('total', x.total)
    .select('id')
  if (error) throw new Error(error.message)
  if (!updated?.length) return null

  const { data: part, error: insertError } = await db
    .from('expenses')
    .insert({
      job_id: jobId,
      supplier: x.supplier,
      supplier_abn: x.supplier_abn,
      invoice_number: x.invoice_number,
      total: movedTotal,
      gst: movedGst,
      is_credit: x.is_credit,
      expense_date: x.expense_date,
      category: x.category,
      job_code_raw: x.job_code_raw,
      confidence: x.confidence,
      status: jobId ? 'approved' : 'pending',
      source: x.source,
      submitted_by: x.submitted_by,
      file_name: x.file_name,
      image_path: x.image_path,
      line_items: moving,
      split_from: x.split_from ?? x.id,
      original_total,
    })
    .select('id')
    .single()
  if (insertError) {
    await db.from('expenses').update({ line_items: x.line_items, total: x.total, gst: x.gst, original_total: x.original_total }).eq('id', expenseId)
    throw new Error(insertError.message)
  }
  return part.id as string
}

// Undo a split: the moved items and their cost go back onto the original invoice. Returns the original's id.
export async function moveItemsBack(db: BusinessDb, expenseId: string) {
  const { data: part } = await db.from('expenses').select('*').eq('id', expenseId).maybeSingle()
  if (!part?.split_from) return null
  const { data: parent } = await db.from('expenses').select('*').eq('id', part.split_from).maybeSingle()
  if (!parent) return null

  const total = cents(Number(parent.total) + Number(part.total))
  const gst = parent.gst == null && part.gst == null ? null : cents(Number(parent.gst ?? 0) + Number(part.gst ?? 0))
  const { data: updated, error } = await db
    .from('expenses')
    .update({
      line_items: [...itemsOf(parent.line_items), ...itemsOf(part.line_items)],
      total,
      gst,
      original_total: total === Number(parent.original_total) ? null : parent.original_total,
    })
    .eq('id', parent.id)
    .eq('total', parent.total)
    .select('id')
  if (error) throw new Error(error.message)
  if (!updated?.length) return null
  await db.from('expenses').delete().eq('id', part.id)
  return parent.id as string
}
