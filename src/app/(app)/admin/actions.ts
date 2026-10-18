'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdmin, setSessionCookie } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { addLogin, cleanEmail, copySampleData, resetPassword } from '@/lib/admin'
import { text } from '@/lib/format'

export type AdminResult = { ok: boolean; message: string; email?: string; password?: string } | null

// New client: a business, its owner's login, and (optionally) the sample jobs to look around
export async function createClientAccount(_prev: AdminResult, formData: FormData): Promise<AdminResult> {
  await requireAdmin()
  const businessName = text(formData.get('business_name'))
  const ownerName = text(formData.get('owner_name'))
  const email = text(formData.get('email'))
  if (!businessName || !email) return { ok: false, message: 'Business name and email are needed.' }

  const sb = createServiceClient()
  const { data: existing } = await sb.from('app_users').select('id').eq('email', cleanEmail(email)).maybeSingle()
  if (existing) return { ok: false, message: 'That email already has a login.' }

  const { data: business, error } = await sb.from('businesses').insert({ name: businessName }).select('id').single()
  if (error || !business) return { ok: false, message: error?.message ?? 'Could not create the business.' }
  try {
    const password = await addLogin(business.id, email, ownerName)
    let sample = ''
    if (formData.get('sample') === 'on') {
      const c = await copySampleData(business.id)
      sample = ` Sample jobs copied in (${c.jobs} jobs).`
    }
    revalidatePath('/admin')
    return { ok: true, message: `${businessName} is ready.${sample}`, email: cleanEmail(email), password }
  } catch (e) {
    await sb.from('businesses').delete().eq('id', business.id)
    return { ok: false, message: e instanceof Error ? e.message : 'Something went wrong.' }
  }
}

export async function addPerson(businessId: string, _prev: AdminResult, formData: FormData): Promise<AdminResult> {
  await requireAdmin()
  const email = text(formData.get('email'))
  if (!email) return { ok: false, message: 'Enter an email.' }
  try {
    const password = await addLogin(businessId, email, text(formData.get('name')), formData.get('role') === 'staff' ? 'staff' : 'owner')
    revalidatePath('/admin')
    return { ok: true, message: 'Login added.', email: cleanEmail(email), password }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Something went wrong.' }
  }
}

export async function newPassword(userId: string, email: string): Promise<AdminResult> {
  await requireAdmin()
  try {
    return { ok: true, message: 'New password made. The old one no longer works.', email, password: await resetPassword(userId) }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Something went wrong.' }
  }
}

export async function setLoginActive(userId: string, active: boolean) {
  const session = await requireAdmin()
  if (userId === session.userId) return
  await createServiceClient().from('app_users').update({ active }).eq('id', userId)
  revalidatePath('/admin')
}

export async function renameBusiness(businessId: string, formData: FormData) {
  await requireAdmin()
  const name = text(formData.get('name'))
  if (name) await createServiceClient().from('businesses').update({ name }).eq('id', businessId)
  revalidatePath('/admin')
}

// Look at a client's account as them (to help set it up). Your own login stays yours.
export async function viewBusiness(businessId: string) {
  const session = await requireAdmin()
  await setSessionCookie(session.userId, businessId)
  redirect('/')
}

export async function backToMyBusiness() {
  const session = await requireAdmin()
  await setSessionCookie(session.userId, session.ownBusinessId)
  redirect('/admin')
}
