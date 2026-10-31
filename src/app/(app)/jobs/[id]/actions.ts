'use server'

import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { redirect } from 'next/navigation'
import { addWorkingDays, cleanJobCode, num, text } from '@/lib/format'
import { readQuote } from '@/lib/quotes'
import { isOutOfCredit } from '@/lib/ai'

function done(jobId: string) {
  revalidatePath(`/jobs/${jobId}`)
  revalidatePath('/')
}

export async function acceptQuote(jobId: string, formData: FormData) {
  const startDate = text(formData.get('start_date'))
  if (!startDate) throw new Error('Pick a start date')
  let plannedFinish = text(formData.get('planned_finish'))

  const { db } = await getDb()
  if (!plannedFinish) {
    const { data: job } = await db.from('jobs').select('quoted_hours').eq('id', jobId).single()
    const crew = Math.max(num(formData.get('crew_size')) ?? 1, 1)
    const days = job?.quoted_hours ? Math.ceil(Number(job.quoted_hours) / (8 * crew)) : 5
    plannedFinish = addWorkingDays(startDate, Math.max(days, 1))
  }

  await db
    .from('jobs')
    .update({ status: 'active', start_date: startDate, planned_finish: plannedFinish, rejection_reason: null, decided_at: new Date().toISOString() })
    .eq('id', jobId)
  done(jobId)
}

export async function rejectQuote(jobId: string, formData: FormData) {
  const reason = text(formData.get('reason'))
  if (!reason) throw new Error('Write why the quote was rejected')
  await (await getDb()).db
    .from('jobs')
    .update({ status: 'rejected', rejection_reason: reason, decided_at: new Date().toISOString() })
    .eq('id', jobId)
  done(jobId)
}

export async function setJobStatus(jobId: string, status: 'quoted' | 'active' | 'complete') {
  await (await getDb()).db
    .from('jobs')
    .update({ status, completed_at: status === 'complete' ? new Date().toISOString() : null })
    .eq('id', jobId)
  done(jobId)
  if (status === 'complete') redirect(`/jobs/${jobId}/report`)
}

export async function updateJob(jobId: string, formData: FormData) {
  const code = cleanJobCode(formData.get('code'))
  if (!code) redirect(`/jobs/${jobId}?codeError=invalid`)
  const { error } = await (await getDb()).db
    .from('jobs')
    .update({
      code,
      client_name: text(formData.get('client_name')),
      address: text(formData.get('address')),
      quote_total: num(formData.get('quote_total')),
      quoted_hours: num(formData.get('quoted_hours')),
      quoted_labour: num(formData.get('quoted_labour')),
      quoted_materials: num(formData.get('quoted_materials')),
      start_date: text(formData.get('start_date')),
      planned_finish: text(formData.get('planned_finish')),
      ...(text(formData.get('day_start')) ? { day_start: text(formData.get('day_start')) } : {}),
      ...(text(formData.get('day_end')) ? { day_end: text(formData.get('day_end')) } : {}),
    })
    .eq('id', jobId)
  if (error) redirect(`/jobs/${jobId}?codeError=${error.code === '23505' ? 'used' : 'invalid'}`)
  done(jobId)
}

export async function addVariation(jobId: string, formData: FormData) {
  const description = text(formData.get('description'))
  if (!description) throw new Error('Describe the variation')
  const { db } = await getDb()
  if (!(await db.owns('jobs', jobId))) throw new Error('Job not found')
  await db.from('variations').insert({
    job_id: jobId,
    description,
    amount: num(formData.get('amount')) ?? 0,
    hours: num(formData.get('hours')) ?? 0,
    materials: num(formData.get('materials')) ?? 0,
  })
  done(jobId)
}

export async function deleteVariation(jobId: string, variationId: string) {
  await (await getDb()).db.from('variations').delete().eq('id', variationId).eq('job_id', jobId)
  done(jobId)
}

// Delete a quote that never went ahead (only quotes and lost quotes, so no hours or invoices are lost)
export async function deleteQuote(jobId: string) {
  const { db } = await getDb()
  const { data: job } = await db.from('jobs').select('status, quote_pdf_path').eq('id', jobId).maybeSingle()
  if (!job || !['quoted', 'rejected'].includes(job.status)) return
  if (job.quote_pdf_path) await db.storage.from('quotes').remove([job.quote_pdf_path])
  await db.from('jobs').delete().eq('id', jobId)
  revalidatePath('/')
  redirect('/?tab=quotes')
}

// A variation (extra work) from its own quote PDF: the AI reads the price, hours and materials
export async function uploadVariation(jobId: string, _prev: string | null, formData: FormData) {
  const { db } = await getDb()
  if (!(await db.owns('jobs', jobId))) return 'Job not found'
  const file = formData.get('pdf') as File | null
  if (!file || file.size === 0) return 'Choose the variation quote PDF'
  const bytes = Buffer.from(await file.arrayBuffer())
  let q
  try {
    q = await readQuote({ name: file.name, contentType: 'application/pdf', data: bytes })
  } catch (e) {
    return isOutOfCredit(e) ? "The AI account has run out of credit, so the quote couldn't be read." : "Couldn't read that PDF. Add the extra by hand below."
  }
  if (q.quote_total == null) return "Couldn't find a price in that PDF. Add the extra by hand below."
  const path = `${db.businessId}/variations/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const { error: upErr } = await db.storage.from('quotes').upload(path, bytes, { contentType: 'application/pdf' })
  await db.from('variations').insert({
    job_id: jobId,
    description: text(formData.get('description')) ?? q.description ?? file.name.replace(/\.pdf$/i, ''),
    amount: q.quote_total,
    hours: q.quoted_hours ?? 0,
    materials: q.quoted_materials ?? 0,
    quote_pdf_path: upErr ? null : path,
  })
  done(jobId)
  return `✓ Added: ${q.quote_total.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })} ex GST${q.quoted_hours ? `, ${q.quoted_hours}h` : ''}. Check the hours and materials below.`
}
