'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { redirect } from 'next/navigation'
import { addWorkingDays, cleanJobCode, num, text } from '@/lib/format'

function done(jobId: string) {
  revalidatePath(`/jobs/${jobId}`)
  revalidatePath('/')
}

export async function acceptQuote(jobId: string, formData: FormData) {
  await requireAuth()
  const startDate = text(formData.get('start_date'))
  if (!startDate) throw new Error('Pick a start date')
  let plannedFinish = text(formData.get('planned_finish'))

  const supabase = createServiceClient()
  if (!plannedFinish) {
    const { data: job } = await supabase.from('jobs').select('quoted_hours').eq('id', jobId).single()
    const crew = Math.max(num(formData.get('crew_size')) ?? 1, 1)
    const days = job?.quoted_hours ? Math.ceil(Number(job.quoted_hours) / (8 * crew)) : 5
    plannedFinish = addWorkingDays(startDate, Math.max(days, 1))
  }

  await supabase
    .from('jobs')
    .update({ status: 'active', start_date: startDate, planned_finish: plannedFinish, rejection_reason: null, decided_at: new Date().toISOString() })
    .eq('id', jobId)
  done(jobId)
}

export async function rejectQuote(jobId: string, formData: FormData) {
  await requireAuth()
  const reason = text(formData.get('reason'))
  if (!reason) throw new Error('Write why the quote was rejected')
  await createServiceClient()
    .from('jobs')
    .update({ status: 'rejected', rejection_reason: reason, decided_at: new Date().toISOString() })
    .eq('id', jobId)
  done(jobId)
}

export async function setJobStatus(jobId: string, status: 'quoted' | 'active' | 'complete') {
  await requireAuth()
  await createServiceClient()
    .from('jobs')
    .update({ status, completed_at: status === 'complete' ? new Date().toISOString() : null })
    .eq('id', jobId)
  done(jobId)
}

export async function updateJob(jobId: string, formData: FormData) {
  await requireAuth()
  const code = cleanJobCode(formData.get('code'))
  if (!code) redirect(`/jobs/${jobId}?codeError=invalid`)
  const { error } = await createServiceClient()
    .from('jobs')
    .update({
      code,
      client_name: text(formData.get('client_name')),
      address: text(formData.get('address')),
      quote_total: num(formData.get('quote_total')),
      quoted_hours: num(formData.get('quoted_hours')),
      quoted_materials: num(formData.get('quoted_materials')),
      start_date: text(formData.get('start_date')),
      planned_finish: text(formData.get('planned_finish')),
    })
    .eq('id', jobId)
  if (error) redirect(`/jobs/${jobId}?codeError=${error.code === '23505' ? 'used' : 'invalid'}`)
  done(jobId)
}

export async function addVariation(jobId: string, formData: FormData) {
  await requireAuth()
  const description = text(formData.get('description'))
  if (!description) throw new Error('Describe the variation')
  await createServiceClient().from('variations').insert({
    job_id: jobId,
    description,
    amount: num(formData.get('amount')) ?? 0,
    hours: num(formData.get('hours')) ?? 0,
    materials: num(formData.get('materials')) ?? 0,
  })
  done(jobId)
}

export async function deleteVariation(jobId: string, variationId: string) {
  await requireAuth()
  await createServiceClient().from('variations').delete().eq('id', variationId).eq('job_id', jobId)
  done(jobId)
}
