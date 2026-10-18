'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE, checkLogin, setSessionCookie } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'

export async function login(_prev: string | null, formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const user = await checkLogin(email, password)
  if (!user) {
    await new Promise((r) => setTimeout(r, 1000))
    return 'Wrong email or password'
  }
  await createServiceClient().from('app_users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id)
  await setSessionCookie(user.id, user.business_id)
  redirect('/')
}

export async function logout() {
  ;(await cookies()).delete(SESSION_COOKIE)
  redirect('/login')
}
