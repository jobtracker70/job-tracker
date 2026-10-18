import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServiceClient } from './supabase'

export const SESSION_COOKIE = 'bb_session'
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

// ---------- Sessions ----------

type SessionData = { u: string; b: string; exp: number } // user, business they're looking at, expiry

export function createSessionValue(userId: string, businessId: string) {
  const body = Buffer.from(JSON.stringify({ u: userId, b: businessId, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE })).toString('base64url')
  return `${body}.${sign(`session:${body}`)}`
}

function readSession(value: string | undefined): SessionData | null {
  if (!value || !(process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY)) return null
  const [body, sig] = value.split('.')
  if (!body || !sig || !safeEqual(sig, sign(`session:${body}`))) return null
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionData
    return data.u && data.b && data.exp > Date.now() / 1000 ? data : null
  } catch {
    return null
  }
}

// Quick check for the proxy (no database): is the cookie genuine and unexpired?
export const isValidSession = (value: string | undefined) => readSession(value) !== null

export async function setSessionCookie(userId: string, businessId: string) {
  ;(await cookies()).set(SESSION_COOKIE, createSessionValue(userId, businessId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  })
}

export type Session = {
  userId: string
  name: string | null
  email: string
  role: 'owner' | 'staff'
  isAdmin: boolean
  businessId: string // the business whose data this person sees
  businessName: string
  ownBusinessId: string // the business they belong to (differs only when the founder is looking at a client's account)
}

// Who is logged in, checked against the database so a removed or disabled login stops working straight away
export async function getSession(): Promise<Session | null> {
  const data = readSession((await cookies()).get(SESSION_COOKIE)?.value)
  if (!data) return null
  const supabase = createServiceClient()
  const { data: user } = await supabase
    .from('app_users')
    .select('id, name, email, role, is_admin, active, business_id')
    .eq('id', data.u)
    .maybeSingle()
  if (!user || !user.active) return null
  // Only the founder may look at another business's account
  const businessId = user.is_admin ? data.b : user.business_id
  const { data: business } = await supabase.from('businesses').select('id, name').eq('id', businessId).maybeSingle()
  if (!business) return null
  return {
    userId: user.id, name: user.name, email: user.email, role: user.role, isAdmin: user.is_admin,
    businessId: business.id, businessName: business.name, ownBusinessId: user.business_id,
  }
}

export async function requireAuth(): Promise<Session> {
  const session = await getSession()
  if (!session) redirect('/login')
  return session
}

export async function requireAdmin(): Promise<Session> {
  const session = await requireAuth()
  if (!session.isAdmin) redirect('/')
  return session
}

// ---------- Passwords ----------

// Stored as "scrypt:<salt>:<hash>"
export function hashPassword(password: string, salt = randomBytes(16).toString('base64url')) {
  return `scrypt:${salt}:${scryptSync(password, salt, 32).toString('base64url')}`
}

export function passwordMatches(input: string, stored: string | null | undefined) {
  if (!stored) return false
  const [, salt] = stored.split(':')
  return !!salt && safeEqual(hashPassword(input, salt), stored)
}

// Email + password -> the user, or null
export async function checkLogin(email: string, password: string) {
  const { data: user } = await createServiceClient()
    .from('app_users')
    .select('id, business_id, password_hash, active')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle()
  if (!user || !user.active || !passwordMatches(password, user.password_hash)) return null
  return user
}
