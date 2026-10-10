'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
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
  await requireAuth()
  const name = text(formData.get('name'))
  const phoneRaw = text(formData.get('phone'))
  const type = String(formData.get('type'))
  if (!name || !phoneRaw) return 'Name and phone are required'
  if (!TYPES.includes(type)) return 'Pick a worker type'

  const supabase = createServiceClient()
  const { data: worker, error } = await supabase
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
  if (error) return error.code === '23505' ? 'That phone number is already added' : error.message

  const rates = rateFields(formData, type)
  if (rates.base_rate != null) {
    await supabase.from('worker_rates').insert({ worker_id: worker.id, effective_from: todaySydney(), ...rates })
  }
  revalidatePath('/workers')
  return null
}

export async function setRate(workerId: string, type: string, formData: FormData) {
  await requireAuth()
  const rates = rateFields(formData, type)
  if (rates.base_rate == null) return
  await createServiceClient()
    .from('worker_rates')
    .insert({ worker_id: workerId, effective_from: text(formData.get('effective_from')) ?? todaySydney(), ...rates })
  revalidatePath('/workers')
}

export async function updateWorker(workerId: string, formData: FormData) {
  await requireAuth()
  const phoneRaw = text(formData.get('phone'))
  const type = String(formData.get('type') ?? '')
  await createServiceClient()
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
  await requireAuth()
  await createServiceClient().from('workers').update({ active }).eq('id', workerId)
  revalidatePath('/workers')
}
