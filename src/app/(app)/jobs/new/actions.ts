'use server'

import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { cleanJobCode } from '@/lib/format'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function uploadQuote(formData: FormData) {
  await requireAuth()
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
  const base64 = Buffer.from(bytes).toString('base64')

  // Ask Claude to extract quote details from the PDF
  let extracted = { quote_total: null as number | null, quoted_hours: null as number | null, quoted_materials: null as number | null, po_ref: null as string | null, client_name: clientName || null, address: address || null }

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 },
            },
            {
              type: 'text',
              text: `Extract from this painting quote PDF and return ONLY valid JSON (no markdown):
{
  "client_name": "string or null",
  "address": "string or null",
  "quote_total": number or null,
  "quoted_hours": number or null,
  "quoted_materials": number or null,
  "po_ref": "string or null"
}
quote_total is the total dollar amount. quoted_hours is estimated labour hours. quoted_materials is estimated materials cost. po_ref is any purchase order number.`,
            },
          ],
        },
      ],
    })

    const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    extracted = {
      quote_total: parsed.quote_total ?? null,
      quoted_hours: parsed.quoted_hours ?? null,
      quoted_materials: parsed.quoted_materials ?? null,
      po_ref: parsed.po_ref ?? null,
      client_name: clientName || parsed.client_name || null,
      address: address || parsed.address || null,
    }
  } catch {
    // Claude failed to parse — create job with what we have
  }

  const supabase = createServiceClient()

  // Upload PDF to storage
  const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  let pdfPath: string | null = null
  const { error: storageError } = await supabase.storage
    .from('quotes')
    .upload(fileName, bytes, { contentType: 'application/pdf' })
  if (!storageError) {
    pdfPath = fileName
  }

  // Create the job (blank code = the database picks the next J-number)
  const { data: job, error } = await supabase
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
