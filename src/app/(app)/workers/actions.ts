'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getDb } from '@/lib/db'
import { num, phoneE164, text, todaySydney } from '@/lib/format'

const TYPES = ['employee', 'apprentice', 'subbie', 'subbie_fixed']
const isSubbie = (type: string) => type === 'subbie' || type === 'subbie_fixed'

function rateFields(formData: FormData, type: string) {
  return {
    base_rate: num(formData.get('rate')),
    oncost_mult: isSubbie(type) ? 1 : num(formData.get('oncost')) ?? 1.4,
    weekend_rate: isSubbie(type) ? null : num(formData.get('weekend_rate')),
    overtime_rate: isSubbie(type) ? null : num(formData.get('overtime_rate')),
    overtime_after: num(formData.get('overtime_after')) ?? 8,
  }
}

export async function addWorker(_prev: string | null, formData: FormData) {
  const name = text(formData.get('name'))
  const phoneRaw = text(formData.get('phone'))
  const type = String(formData.get('type'))
  if (!name || !phoneRaw) return 'Name and phone are required'
  if (!TYPES.includes(type)) return 'Pick a worker type'

  const { db } = await getDb()
  const { data: worker, error } = await db
    .from('workers')
    .insert({
      name,
      phone: phoneE164(phoneRaw),
      type,
      abn: text(formData.get('abn')),
      break_minutes: Math.max(0, Math.round(num(formData.get('break_minutes')) ?? 0)),
    })
    .select('id')
    .single()
  if (error) return error.code === '23505' ? 'That phone number is already on your Workers list. Edit that worker instead, or remove them first.' : error.message

  const rates = rateFields(formData, type)
  if (rates.base_rate != null) {
    await db.raw.from('worker_rates').insert({ worker_id: worker.id, effective_from: todaySydney(), ...rates })
  }
  revalidatePath('/workers')
  return null
}

export async function setRate(workerId: string, type: string, formData: FormData) {
  const rates = rateFields(formData, type)
  if (rates.base_rate == null) return
  const { db } = await getDb()
  if (!(await db.owns('workers', workerId))) return
  // A second change on the same day replaces that day's rate
  await db.raw
    .from('worker_rates')
    .upsert({ worker_id: workerId, effective_from: text(formData.get('effective_from')) ?? todaySydney(), ...rates }, { onConflict: 'worker_id,effective_from' })
  revalidatePath('/workers')
}

export async function updateWorker(workerId: string, formData: FormData) {
  const phoneRaw = text(formData.get('phone'))
  const type = String(formData.get('type') ?? '')
  const { db } = await getDb()
  const { error } = await db
    .from('workers')
    .update({
      name: text(formData.get('name')) ?? undefined,
      phone: phoneRaw ? phoneE164(phoneRaw) : undefined,
      abn: text(formData.get('abn')),
      type: TYPES.includes(type) ? type : undefined,
      break_minutes: Math.max(0, Math.round(num(formData.get('break_minutes')) ?? 0)),
    })
    .eq('id', workerId)
  if (error?.code === '23505') redirect(`/workers?error=${encodeURIComponent('That phone number is already on your Workers list.')}`)
  revalidatePath('/workers')
}

export async function setActive(workerId: string, active: boolean) {
  await (await getDb()).db.from('workers').update({ active }).eq('id', workerId)
  revalidatePath('/workers')
}

// Remove a worker from BrushBooks. Their number is freed (so it can be added again, here or by another business).
// Workers with no hours or invoices are deleted outright; otherwise their past hours stay on the jobs.
export async function removeWorker(workerId: string) {
  const { db } = await getDb()
  if (!(await db.owns('workers', workerId))) return
  const [{ count: shifts }, { count: invoices }] = await Promise.all([
    db.from('time_entries').select('id', { count: 'exact', head: true }).eq('worker_id', workerId),
    db.from('expenses').select('id', { count: 'exact', head: true }).or(`worker_id.eq.${workerId},submitted_by.eq.${workerId}`),
  ])
  if (!shifts && !invoices) await db.from('workers').delete().eq('id', workerId)
  else await db.from('workers').update({ active: false, removed_at: new Date().toISOString() }).eq('id', workerId)
  revalidatePath('/workers')
}
