import { parseJsonReply, pdfText, readDocument, type AiFile } from './ai'

export type QuoteDetails = {
  client_name: string | null
  address: string | null
  po_ref: string | null
  quote_total: number | null // ex GST
  quoted_hours: number | null // only if the quote states labour hours
  quoted_labour: number | null // labour $ ex GST, only if the quote states it
  quoted_materials: number | null // materials $ ex GST, only if the quote states it
  description: string | null // short summary of the work (used for variations)
}

const PROMPT = `You are reading a quote from an Australian painting or trade business. Read EVERY page; totals are usually on the last page.
Return ONLY valid JSON (no markdown):
{
  "client_name": "who the quote is for, or null",
  "address": "the job/site address (often the Reference), or null",
  "po_ref": "purchase order number if shown, else null",
  "quote_total": the price EXCLUDING GST: use the Subtotal before GST; if only a GST-inclusive total is shown, divide it by 1.1,
  "quoted_hours": total labour HOURS only if the quote literally states hours, else null,
  "quoted_labour": total LABOUR cost in dollars excluding GST only if the quote states a labour amount separately, else null,
  "quoted_materials": total MATERIALS cost in dollars excluding GST only if the quote states materials separately, else null,
  "description": "one short line describing the work, e.g. 'Repaint 3 levels: ceilings, walls, doors and frames'"
}
Never guess hours, labour or materials, and never use the GST amount as materials. Use null when the quote doesn't say.`

// "$ 40,000.00" right after a label, anywhere in the text
function amountAfter(text: string, label: RegExp) {
  const m = text.match(new RegExp(label.source + String.raw`[^\d$]{0,25}\$?\s*([\d,]+(?:\.\d{1,2})?)`, 'i'))
  return m ? Number(m[1].replace(/,/g, '')) : null
}

export async function readQuote(file: AiFile): Promise<QuoteDetails> {
  const text = await pdfText(file.data)
  const reply = await readDocument(
    'quotes',
    text ? { name: file.name, contentType: 'text/plain', data: Buffer.from(text) } : file,
    PROMPT,
    1200,
  )
  const q = parseJsonReply<Partial<QuoteDetails>>(reply) ?? {}
  const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
  const out: QuoteDetails = {
    client_name: q.client_name ?? null,
    address: q.address ?? null,
    po_ref: q.po_ref ?? null,
    quote_total: num(q.quote_total),
    quoted_hours: num(q.quoted_hours),
    quoted_labour: num(q.quoted_labour),
    quoted_materials: num(q.quoted_materials),
    description: q.description ?? null,
  }

  // The totals printed on the quote beat the AI's reading
  if (text) {
    const subtotal = amountAfter(text, /sub[\s-]?total/)
    const gst = amountAfter(text, /GST(?:\s*10\s*%)?/)
    const total = amountAfter(text, /(?<!sub[\s-]?)\btotal\b(?:\s*\(?inc[a-z. ]*gst\)?)?/)
    if (subtotal) out.quote_total = subtotal
    else if (total && gst && gst < total) out.quote_total = Math.round((total - gst) * 100) / 100
    if (gst && out.quoted_materials != null && Math.abs(out.quoted_materials - gst) < 1) out.quoted_materials = null
  }
  // Sanity: nothing can cost more than the whole job, and nobody quotes 2,000+ hours on a house
  const cap = out.quote_total ?? Infinity
  if (out.quoted_labour != null && out.quoted_labour > cap) out.quoted_labour = null
  if (out.quoted_materials != null && out.quoted_materials > cap) out.quoted_materials = null
  if (out.quoted_hours != null && (out.quoted_hours > 2000 || out.quoted_hours <= 0)) out.quoted_hours = null
  return out
}
