'use server'

import { getDb } from '@/lib/db'
import { redirect } from 'next/navigation'
import { cleanJobCode } from '@/lib/format'
import { readQuote } from '@/lib/quotes'

export async function uploadQuote(formData: FormData) {
  const { db } = await getDb()
  const file = formData.get('pdf') as File | null
  const clientName = formData.get('client_name') as string
  const address = formData.get('address') as string
  const rawCode = String(formData.get('job_code') ?? '').trim()
  const jobCode = cleanJobCode(rawCode)
  if (rawCode && !jobCode) throw new Error('Job code: use 2–24 letters, numbers or dashes, e.g. SMITH-PENRITH')

  if (!file || file.size === 0) {
    throw new Error('No PDF uploaded')
  }

  const bytes = await file.arrayBuffer()

  // Read the quote (every page) for its totals
  let extracted = { quote_total: null as number | null, quoted_hours: null as number | null, quoted_labour: null as number | null, quoted_materials: null as number | null, po_ref: null as string | null, client_name: clientName || null, address: address || null }
  try {
    const q = await readQuote({ name: file.name, contentType: 'application/pdf', data: Buffer.from(bytes) })
    extracted = { ...q, client_name: clientName || q.client_name, address: address || q.address }
  } catch {
    // The AI couldn't read it — create the job with what we have
  }

  // Upload PDF to storage (in this business's folder)
  const fileName = `${db.businessId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  let pdfPath: string | null = null
  const { error: storageError } = await db.storage
    .from('quotes')
    .upload(fileName, bytes, { contentType: 'application/pdf' })
  if (!storageError) {
    pdfPath = fileName
  }

  // Create the job (blank code = the database picks the next J-number)
  const { data: job, error } = await db
    .from('jobs')
    .insert({
      code: jobCode ?? '',
      client_name: extracted.client_name,
      address: extracted.address,
      quote_total: extracted.quote_total,
      quoted_hours: extracted.quoted_hours,
      quoted_labour: extracted.quoted_labour,
      quoted_materials: extracted.quoted_materials,
      po_ref: extracted.po_ref,
      quote_pdf_path: pdfPath,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.code === '23505' ? `The job code "${jobCode}" is already used. Pick another.` : error.message)

  redirect(`/jobs/${job.id}`)
}
