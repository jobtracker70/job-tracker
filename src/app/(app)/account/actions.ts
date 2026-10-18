'use server'

import { hashPassword, passwordMatches, requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'

export type PasswordResult = { ok: boolean; message: string } | null

export async function changePassword(_prev: PasswordResult, formData: FormData): Promise<PasswordResult> {
  const session = await requireAuth()
  const current = String(formData.get('current') ?? '')
  const next = String(formData.get('new') ?? '')
  const again = String(formData.get('again') ?? '')
  if (next.length < 8) return { ok: false, message: 'Make the new password at least 8 characters.' }
  if (next !== again) return { ok: false, message: "The two new passwords don't match." }

  const sb = createServiceClient()
  const { data: user } = await sb.from('app_users').select('password_hash').eq('id', session.userId).single()
  if (!passwordMatches(current, user?.password_hash)) {
    await new Promise((r) => setTimeout(r, 1000))
    return { ok: false, message: 'Your current password is wrong.' }
  }
  await sb.from('app_users').update({ password_hash: hashPassword(next) }).eq('id', session.userId)
  return { ok: true, message: 'Password changed ✓ Use the new one next time you log in.' }
}
