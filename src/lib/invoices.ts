import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from './supabase'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-5-5'

export type InvoiceFile = { name: string; contentType: string; data: Buffer }

type Extracted = {
  is_invoice: boolean
  supplier: string | null
  supplier_abn: string | null
  invoice_number: string | null
  invoice_date: string | null
  total: number | null
  gst: number | null
  job_code: string | null
  category: 'materials' | 'subbie' | 'other'
  hours: number | null
  confidence: 'high' | 'medium' | 'low'
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const

export function isReadableInvoiceType(contentType: string, name: string) {
  const ct = contentType.toLowerCase()
  return ct === 'application/pdf' || (IMAGE_TYPES as readonly string[]).includes(ct) || ct.includes('csv') || /\.(pdf|csv)$/i.test(name)
}

const PROMPT = `You are reading a document sent to a NSW painting business. Decide if it is a supplier invoice/receipt or a subcontractor ("subbie") invoice, and extract details.
Job codes look like "J-1001" (sometimes written J1001, Job 1001, or in a PO / reference / description field).
Return ONLY valid JSON, no markdown:
{
  "is_invoice": true/false,
  "supplier": "business or person who issued it, or null",
  "supplier_abn": "11 digit ABN or null",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "total": number incl GST or null,
  "gst": number or null,
  "job_code": "J-1234 or null",
  "category": "materials" (paint, supplies, equipment hire) | "subbie" (labour charged by a subcontractor) | "other",
  "hours": total labour hours billed if this is a subbie invoice, else null,
  "confidence": "high" | "medium" | "low"
}
Statements, quotes, marketing and remittance advice are NOT invoices.`

function contentFor(file: InvoiceFile, hint?: string): Anthropic.Messages.ContentBlockParam[] {
  const ct = file.contentType.toLowerCase()
  const blocks: Anthropic.Messages.ContentBlockParam[] = []
  if (ct === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data.toString('base64') } })
  } else if ((IMAGE_TYPES as readonly string[]).includes(ct)) {
    blocks.push({ type: 'image', source: { type: 'base64', media_type: ct as (typeof IMAGE_TYPES)[number], data: file.data.toString('base64') } })
  } else {
    blocks.push({ type: 'text', text: `File "${file.name}":\n${file.data.toString('utf8').slice(0, 60000)}` })
  }
  blocks.push({ type: 'text', text: hint ? `${PROMPT}\n\nThe email it came with (may contain the job code):\n${hint.slice(0, 3000)}` : PROMPT })
  return blocks
}

export async function extractInvoice(file: InvoiceFile, hint?: string): Promise<Extracted | null> {
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: contentFor(file, hint) }],
  })
  const t = msg.content.find((c) => c.type === 'text')
  if (!t || t.type !== 'text') return null
  try {
    return JSON.parse(t.text.slice(t.text.indexOf('{'), t.text.lastIndexOf('}') + 1)) as Extracted
  } catch {
    return null
  }
}

export function normaliseJobCode(s: string | null | undefined) {
  const m = s?.match(/\bJ(?:OB)?[\s#-]*(\d{4,})\b/i)
  return m ? `J-${m[1]}` : null
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

// Reads one file and saves it as an expense. Returns null if it isn't an invoice.
export async function processInvoiceFile(
  file: InvoiceFile,
  opts: { source: 'email' | 'upload'; emailMessageId?: string; hint?: string; jobId?: string },
) {
  const x = await extractInvoice(file, opts.hint)
  if (!x || !x.is_invoice || x.total == null) return null

  const supabase = createServiceClient()
  const code = normaliseJobCode(x.job_code) ?? normaliseJobCode(opts.hint)

  let jobId = opts.jobId ?? null
  if (!jobId && code) {
    const { data: job } = await supabase.from('jobs').select('id').eq('code', code).maybeSingle()
    jobId = job?.id ?? null
  }

  let workerId: string | null = null
  if (x.category === 'subbie') {
    const { data: subbies } = await supabase.from('workers').select('id, name, abn').eq('type', 'subbie')
    const abn = digits(x.supplier_abn)
    const supplier = (x.supplier ?? '').toLowerCase()
    const match = (subbies ?? []).find(
      (s) =>
        (abn && digits(s.abn) === abn) ||
        (supplier.length >= 3 && s.name.length >= 3 &&
          (supplier.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(supplier))),
    )
    workerId = match?.id ?? null
  }

  const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const { error: uploadError } = await supabase.storage.from('invoices').upload(path, file.data, { contentType: file.contentType })

  const confident = x.confidence !== 'low'
  const subbieOk = x.category !== 'subbie' || (workerId != null && x.hours != null)
  const status = jobId && confident && subbieOk ? 'approved' : 'pending'

  const { data, error } = await supabase
    .from('expenses')
    .insert({
      job_id: jobId,
      supplier: x.supplier,
      supplier_abn: x.supplier_abn,
      invoice_number: x.invoice_number,
      total: x.total,
      gst: x.gst,
      expense_date: x.invoice_date,
      category: ['materials', 'subbie', 'other'].includes(x.category) ? x.category : 'other',
      hours: x.hours,
      worker_id: workerId,
      job_code_raw: x.job_code,
      confidence: x.confidence,
      status,
      source: opts.source,
      email_message_id: opts.emailMessageId ?? null,
      file_name: file.name,
      image_path: uploadError ? null : path,
      extraction_json: x,
    })
    .select('id, status')
    .single()
  if (error) throw new Error(error.message)
  return data
}
