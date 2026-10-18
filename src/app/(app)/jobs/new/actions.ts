'use server'

import { getDb } from '@/lib/db'
import { redirect } from 'next/navigation'
import { cleanJobCode } from '@/lib/format'
import { parseJsonReply, readDocument } from '@/lib/ai'

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

  // Ask the AI to read the quote details from the PDF
  let extracted = { quote_total: null as number | null, quoted_hours: null as number | null, quoted_materials: null as number | null, po_ref: null as string | null, client_name: clientName || null, address: address || null }

  try {
    const text = await readDocument(
      'quotes',
      { name: file.name, contentType: 'application/pdf', data: Buffer.from(bytes) },
      `Extract from this painting quote PDF and return ONLY valid JSON (no markdown):
{
  "client_name": "string or null",
  "address": "string or null",
  "quote_total": number or null,
  "quoted_hours": number or null,
  "quoted_materials": number or null,
  "po_ref": "string or null"
}
The business is GST-registered, so all dollar amounts must be EXCLUDING GST.
quote_total is the quote price excluding GST (use the subtotal before GST; if only a GST-inclusive total is shown, divide it by 1.1).
quoted_hours is the estimated labour hours. quoted_materials is the estimated materials cost excluding GST. po_ref is any purchase order number.`,
      1024,
    )
    const parsed = parseJsonReply<{
      client_name?: string | null; address?: string | null; quote_total?: number | null
      quoted_hours?: number | null; quoted_materials?: number | null; po_ref?: string | null
    }>(text)
    if (!parsed) throw new Error('unreadable')
    extracted = {
      quote_total: parsed.quote_total ?? null,
      quoted_hours: parsed.quoted_hours ?? null,
      quoted_materials: parsed.quoted_materials ?? null,
      po_ref: parsed.po_ref ?? null,
      client_name: clientName || parsed.client_name || null,
      address: address || parsed.address || null,
    }
  } catch {
    // The AI couldn't read it — create job with what we have
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
      quoted_materials: extracted.quoted_materials,
      po_ref: extracted.po_ref,
      quote_pdf_path: pdfPath,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.code === '23505' ? `The job code "${jobCode}" is already used. Pick another.` : error.message)

  redirect(`/jobs/${job.id}`)
}
