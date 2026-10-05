'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE, SESSION_MAX_AGE, checkPassword, createSessionValue } from '@/lib/auth'

export async function login(_prev: string | null, formData: FormData) {
  const password = String(formData.get('password') ?? '')
  if (!checkPassword(password)) {
    await new Promise((r) => setTimeout(r, 1000))
    return 'Wrong password'
  }
  ;(await cookies()).set(SESSION_COOKIE, createSessionValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  })
  redirect('/')
}

export async function logout() {
  ;(await cookies()).delete(SESSION_COOKIE)
  redirect('/login')
}
