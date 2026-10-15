'use server'

import { revalidatePath } from 'next/cache'
import { openPayload, requireAuth } from '@/lib/auth'
import { applyChange, type Change } from '@/lib/assistant'

export async function confirmAction(token: string) {
  await requireAuth()
  const payload = openPayload<{ change: Change; exp: number }>(token)
  if (!payload) return { ok: false, message: "That change couldn't be checked, so nothing was changed." }
  if (payload.exp < Date.now()) return { ok: false, message: 'That suggestion is too old. Ask again and confirm the new one.' }
  try {
    const message = await applyChange(payload.change)
    revalidatePath('/', 'layout')
    return { ok: true, message }
  } catch (e) {
    console.error('assistant change failed', e)
    return { ok: false, message: 'Sorry, that change failed, so nothing was changed.' }
  }
}
