import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from './supabase'
import { compactCode } from './format'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-5-5'

export type InvoiceFile = { name: string; contentType: string; data: Buffer }

type Extracted = {
  is_invoice: boolean
  supplier: string | null
  supplier_abn: string | null
  invoice_number: string | null
  invoice_date: string | null
  is_credit: boolean
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

const promptFor = (codes: string[]) => `You are reading a document sent to a NSW painting business. Decide if it is a supplier invoice/receipt or a subcontractor ("subbie") invoice, and extract details.
The business gives every job its own job code. The current job codes are: ${codes.length ? codes.slice(0, 150).join(', ') : '(none yet)'}.
Look anywhere in the document (reference, PO number, description, notes) for one of those codes, and return it exactly as listed. If none appears, return null.
Return ONLY valid JSON, no markdown:
{
  "is_invoice": true/false,
  "supplier": "business or person who issued it, or null",
  "supplier_abn": "11 digit ABN or null",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "is_credit": true if this is a credit note, refund or return (money back to the business), else false,
  "total": total amount INCLUDING GST as a positive number, or null,
  "gst": the GST amount shown as a positive number; 0 if the document shows no GST,
  "job_code": "one of the listed job codes, or null",
  "category": "materials" (paint, supplies, equipment hire) | "subbie" (labour charged by a subcontractor) | "other",
  "hours": total labour hours billed if this is a subbie invoice, else null,
  "confidence": "high" | "medium" | "low"
}
Statements, quotes, marketing and remittance advice are NOT invoices. Credit notes, refund receipts and return receipts DO count (set is_credit true).`

function contentFor(file: InvoiceFile, codes: string[], hint?: string): Anthropic.Messages.ContentBlockParam[] {
  const ct = file.contentType.toLowerCase()
  const blocks: Anthropic.Messages.ContentBlockParam[] = []
  if (ct === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data.toString('base64') } })
  } else if ((IMAGE_TYPES as readonly string[]).includes(ct)) {
    blocks.push({ type: 'image', source: { type: 'base64', media_type: ct as (typeof IMAGE_TYPES)[number], data: file.data.toString('base64') } })
  } else {
    blocks.push({ type: 'text', text: `File "${file.name}":\n${file.data.toString('utf8').slice(0, 60000)}` })
  }
  const prompt = promptFor(codes)
  blocks.push({ type: 'text', text: hint ? `${prompt}\n\nThe email it came with (may contain the job code):\n${hint.slice(0, 3000)}` : prompt })
  return blocks
}

export async function extractInvoice(file: InvoiceFile, codes: string[], hint?: string): Promise<Extracted | null> {
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: contentFor(file, codes, hint) }],
  })
  const t = msg.content.find((c) => c.type === 'text')
  if (!t || t.type !== 'text') return null
  try {
    return JSON.parse(t.text.slice(t.text.indexOf('{'), t.text.lastIndexOf('}') + 1)) as Extracted
  } catch {
    return null
  }
}

type JobRef = { id: string; code: string }

function findJobByCode(jobs: JobRef[], raw: string | null | undefined) {
  const c = compactCode(raw)
  return c ? jobs.find((j) => compactCode(j.code) === c) ?? null : null
}

// Looks for any known job code as a whole word in free text (e.g. the email subject or body).
function findJobInText(jobs: JobRef[], text: string | null | undefined) {
  const up = (text ?? '').toUpperCase()
  if (!up) return null
  for (const j of [...jobs].sort((x, y) => y.code.length - x.code.length)) {
    const esc = j.code.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(?<![A-Z0-9])${esc}(?![A-Z0-9])`).test(up)) return j
  }
  return null
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

const SUBBIE_TYPES = ['subbie', 'subbie_fixed']

export type SavedInvoice = {
  id: string
  status: string
  job_id: string | null
  supplier: string | null
  total: number
  duplicate: boolean
}

// Reads one file and saves it as an expense. Returns null if it isn't an invoice.
// An exact repeat (same supplier, invoice number and amount) is not saved again: it comes back with duplicate = true.
export async function processInvoiceFile(
  file: InvoiceFile,
  opts: { source: 'email' | 'upload' | 'whatsapp'; emailMessageId?: string; hint?: string; jobId?: string; submittedBy?: string },
): Promise<SavedInvoice | null> {
  const supabase = createServiceClient()
  const { data: jobRows } = await supabase.from('jobs').select('id, code').neq('status', 'rejected')
  const jobs = (jobRows ?? []) as JobRef[]

  const x = await extractInvoice(file, jobs.map((j) => j.code), opts.hint)
  if (!x || !x.is_invoice || x.total == null) return null

  // Credits reduce the job's cost
  const sign = x.is_credit ? -1 : 1
  const total = sign * Math.abs(Number(x.total))
  const gst = x.gst == null ? null : sign * Math.abs(Number(x.gst))

  // Duplicate check: same amount, then same supplier, then same invoice number (or same date if no number)
  const { data: sameAmount } = await supabase
    .from('expenses')
    .select('id, status, job_id, supplier, invoice_number, expense_date, total')
    .eq('total', total)
    .neq('status', 'rejected')
  const sameSupplier = (sameAmount ?? []).filter((e) => {
    const a = compactCode(e.supplier)
    const b = compactCode(x.supplier)
    return a && b && (a === b || a.includes(b) || b.includes(a))
  })
  const exact = sameSupplier.find(
    (e) => x.invoice_number && e.invoice_number && compactCode(e.invoice_number) === compactCode(x.invoice_number),
  )
  if (exact) {
    return { id: exact.id, status: exact.status, job_id: exact.job_id, supplier: exact.supplier, total, duplicate: true }
  }
  const possibleDuplicate = sameSupplier.some(
    (e) => (!x.invoice_number || !e.invoice_number) && x.invoice_date && e.expense_date === x.invoice_date,
  )

  const jobId = opts.jobId ?? (findJobByCode(jobs, x.job_code) ?? findJobInText(jobs, opts.hint))?.id ?? null

  let workerId: string | null = null
  let fixedPrice = false
  if (x.category === 'subbie') {
    const { data: subbies } = await supabase.from('workers').select('id, name, abn, type').in('type', SUBBIE_TYPES)
    const abn = digits(x.supplier_abn)
    const supplier = (x.supplier ?? '').toLowerCase()
    const match = (subbies ?? []).find(
      (s) =>
        (abn && digits(s.abn) === abn) ||
        (supplier.length >= 3 && s.name.length >= 3 &&
          (supplier.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(supplier))),
    )
    workerId = match?.id ?? null
    fixedPrice = match?.type === 'subbie_fixed'
  }

  const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const { error: uploadError } = await supabase.storage.from('invoices').upload(path, file.data, { contentType: file.contentType })

  const confident = x.confidence !== 'low'
  // Hourly subbies must show hours so they can be checked against WhatsApp sign-ins; fixed-price subbies don't.
  const subbieOk = x.category !== 'subbie' || (workerId != null && (fixedPrice || x.hours != null))
  const status = jobId && confident && subbieOk && !possibleDuplicate ? 'approved' : 'pending'

  const { data, error } = await supabase
    .from('expenses')
    .insert({
      job_id: jobId,
      supplier: x.supplier,
      supplier_abn: x.supplier_abn,
      invoice_number: x.invoice_number,
      total,
      gst,
      is_credit: !!x.is_credit,
      expense_date: x.invoice_date,
      category: ['materials', 'subbie', 'other'].includes(x.category) ? x.category : 'other',
      hours: x.hours,
      worker_id: workerId,
      job_code_raw: x.job_code,
      confidence: x.confidence,
      status,
      source: opts.source,
      email_message_id: opts.emailMessageId ?? null,
      submitted_by: opts.submittedBy ?? null,
      note: possibleDuplicate ? 'Possible duplicate: same supplier, amount and date as an invoice already added.' : null,
      file_name: file.name,
      image_path: uploadError ? null : path,
      extraction_json: x,
    })
    .select('id, status, job_id, supplier, total')
    .single()
  if (error) throw new Error(error.message)
  return { ...data, total: Number(data.total), duplicate: false }
}
