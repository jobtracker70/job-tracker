'use server'

import { revalidatePath } from 'next/cache'
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
  if (error) return error.code === '23505' ? 'That phone number is already used by another worker (WhatsApp numbers can only belong to one worker)' : error.message

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
  await db.raw
    .from('worker_rates')
    .insert({ worker_id: workerId, effective_from: text(formData.get('effective_from')) ?? todaySydney(), ...rates })
  revalidatePath('/workers')
}

export async function updateWorker(workerId: string, formData: FormData) {
  const phoneRaw = text(formData.get('phone'))
  const type = String(formData.get('type') ?? '')
  await (await getDb()).db
    .from('workers')
    .update({
      name: text(formData.get('name')) ?? undefined,
      phone: phoneRaw ? phoneE164(phoneRaw) : undefined,
      abn: text(formData.get('abn')),
      type: TYPES.includes(type) ? type : undefined,
      break_minutes: Math.max(0, Math.round(num(formData.get('break_minutes')) ?? 0)),
    })
    .eq('id', workerId)
  revalidatePath('/workers')
}

export async function setActive(workerId: string, active: boolean) {
  await (await getDb()).db.from('workers').update({ active }).eq('id', workerId)
  revalidatePath('/workers')
}
