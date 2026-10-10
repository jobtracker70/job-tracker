'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { sydneyLocalToISO, text } from '@/lib/format'

function done(back: string) {
  revalidatePath('/hours')
  revalidatePath('/')
  redirect(back)
}

function readTimes(formData: FormData) {
  const start = sydneyLocalToISO(String(formData.get('start') ?? ''))
  const endRaw = text(formData.get('end'))
  const end = endRaw ? sydneyLocalToISO(endRaw) : null
  if (!start) return { error: 'Enter a start time' }
  if (endRaw && !end) return { error: 'The finish time is not valid' }
  if (end && new Date(end) <= new Date(start)) return { error: 'Finish must be after start' }
  if (end && new Date(end).getTime() - new Date(start).getTime() > 16 * 3600000) return { error: 'That shift is over 16 hours' }
  return { start, end }
}

const backTo = (formData: FormData) => String(formData.get('back') || '/hours')
const withError = (back: string, msg: string) => `${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(msg)}`

export async function addEntry(formData: FormData) {
  await requireAuth()
  const back = backTo(formData)
  const t = readTimes(formData)
  const workerId = text(formData.get('worker_id'))
  const jobId = text(formData.get('job_id'))
  if ('error' in t) redirect(withError(back, t.error!))
  if (!workerId || !jobId) redirect(withError(back, 'Pick a worker and a job'))
  await createServiceClient().from('time_entries').insert({
    worker_id: workerId,
    job_id: jobId,
    start_time: t.start,
    end_time: t.end,
    source: 'manual',
    edited_by: 'owner',
    review_reason: 'Added by owner',
  })
  done(back)
}

export async function updateEntry(entryId: string, formData: FormData) {
  await requireAuth()
  const back = backTo(formData)
  const t = readTimes(formData)
  if ('error' in t) redirect(withError(back, t.error!))
  await createServiceClient()
    .from('time_entries')
    .update({
      start_time: t.start,
      end_time: t.end,
      job_id: text(formData.get('job_id')) ?? undefined,
      edited_by: 'owner',
      needs_review: false,
      review_reason: 'Changed by owner',
    })
    .eq('id', entryId)
  done(back)
}

export async function markReviewed(entryId: string, back: string) {
  await requireAuth()
  await createServiceClient().from('time_entries').update({ needs_review: false }).eq('id', entryId)
  done(back)
}

export async function deleteEntry(entryId: string, back: string) {
  await requireAuth()
  await createServiceClient().from('time_entries').delete().eq('id', entryId)
  done(back)
}
