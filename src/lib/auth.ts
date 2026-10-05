import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export const SESSION_COOKIE = 'jt_session'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30

function sign(value: string) {
  return createHmac('sha256', process.env.SESSION_SECRET!).update(value).digest('base64url')
}

function safeEqual(a: string, b: string) {
  const ha = createHmac('sha256', 'cmp').update(a).digest()
  const hb = createHmac('sha256', 'cmp').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function createSessionValue() {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_MAX_AGE)
  return `${exp}.${sign(exp)}`
}

export function isValidSession(value: string | undefined) {
  if (!value || !process.env.SESSION_SECRET) return false
  const [exp, sig] = value.split('.')
  if (!exp || !sig || !safeEqual(sig, sign(exp))) return false
  return Number(exp) > Date.now() / 1000
}

export function checkPassword(input: string) {
  const password = process.env.APP_PASSWORD
  return !!password && safeEqual(input, password)
}

export async function requireAuth() {
  const value = (await cookies()).get(SESSION_COOKIE)?.value
  if (!isValidSession(value)) redirect('/login')
}
