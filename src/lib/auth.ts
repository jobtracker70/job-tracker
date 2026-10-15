import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServiceClient } from './supabase'

export const SESSION_COOKIE = 'jt_session'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30

// Falls back to a key derived from the Supabase server key, so no extra hosting setting is needed.
function sessionSecret() {
  return (
    process.env.SESSION_SECRET ??
    createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').update('jt-session-secret').digest('base64url')
  )
}

function sign(value: string) {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url')
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
  if (!value || !(process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY)) return false
  const [exp, sig] = value.split('.')
  if (!exp || !sig || !safeEqual(sig, sign(exp))) return false
  return Number(exp) > Date.now() / 1000
}

// Signed, tamper-proof data handed to the browser (e.g. a change the AI assistant proposed, waiting for Confirm)
export function sealPayload(data: object) {
  const body = Buffer.from(JSON.stringify(data)).toString('base64url')
  return `${body}.${sign(`payload:${body}`)}`
}

export function openPayload<T>(token: string): T | null {
  const [body, sig] = token.split('.')
  if (!body || !sig || !safeEqual(sig, sign(`payload:${body}`))) return null
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}

// Stored as "scrypt:<salt>:<hash>" in app_settings.password_hash; APP_PASSWORD overrides it if set.
export function hashPassword(password: string, salt: string) {
  return `scrypt:${salt}:${scryptSync(password, salt, 32).toString('base64url')}`
}

export async function checkPassword(input: string) {
  if (process.env.APP_PASSWORD) return safeEqual(input, process.env.APP_PASSWORD)
  const { data } = await createServiceClient().from('app_settings').select('value').eq('key', 'password_hash').maybeSingle()
  const stored = data?.value
  if (!stored) return false
  const [, salt] = stored.split(':')
  return !!salt && safeEqual(hashPassword(input, salt), stored)
}

export async function requireAuth() {
  const value = (await cookies()).get(SESSION_COOKIE)?.value
  if (!isValidSession(value)) redirect('/login')
}
