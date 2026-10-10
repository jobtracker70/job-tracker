import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createServiceClient } from './supabase'
import { isReadableInvoiceType, processInvoiceFile } from './invoices'

export function emailConfigured() {
  return !!(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD)
}

export type InboxResult = { emailsRead: number; invoicesFound: number; leftForNextRun: number; errors: string[] }

// Reads recent emails (without marking them read), and turns invoice attachments into expenses.
// Each email is only processed once. Stops early to stay inside the server time limit.
export async function checkInbox({ days = 7, timeBudgetMs = 45000 } = {}): Promise<InboxResult> {
  const started = Date.now()
  const result: InboxResult = { emailsRead: 0, invoicesFound: 0, leftForNextRun: 0, errors: [] }
  const supabase = createServiceClient()

  const client = new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: true,
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
    logger: false,
  })
  await client.connect()
  const lock = await client.getMailboxLock('INBOX')

  try {
    const uids = (await client.search({ since: new Date(Date.now() - days * 86400000) }, { uid: true })) || []

    for (const [i, uid] of uids.entries()) {
      if (Date.now() - started > timeBudgetMs) {
        result.leftForNextRun = uids.length - i
        break
      }
      const msg = await client.fetchOne(String(uid), { envelope: true, source: true }, { uid: true })
      if (!msg || !msg.source) continue
      const messageId = msg.envelope?.messageId ?? `uid-${uid}`

      const { data: seen } = await supabase.from('processed_emails').select('message_id').eq('message_id', messageId).maybeSingle()
      if (seen) continue

      const parsed = await simpleParser(msg.source)
      const hint = `Subject: ${parsed.subject ?? ''}\n${(parsed.text ?? '').slice(0, 3000)}`
      let found = 0
      let failed = false

      for (const att of parsed.attachments) {
        const name = att.filename ?? 'attachment'
        if (!isReadableInvoiceType(att.contentType, name)) continue
        // Skip logos and signature images
        if (att.contentType.startsWith('image/') && (att.contentDisposition === 'inline' || att.size < 15000)) continue
        try {
          const saved = await processInvoiceFile(
            { name, contentType: att.contentType, data: att.content },
            { source: 'email', emailMessageId: messageId, hint },
          )
          if (saved) found++
        } catch (e) {
          failed = true
          result.errors.push(`${parsed.subject ?? name}: ${e instanceof Error ? e.message : 'failed'}`)
        }
      }

      // Some suppliers (e.g. e-receipts) put the receipt in the email text with no attachment.
      const body = (parsed.text ?? '').trim()
      if (found === 0 && body.length >= 80) {
        try {
          const text = `Subject: ${parsed.subject ?? ''}\nFrom: ${parsed.from?.text ?? ''}\nDate: ${parsed.date?.toISOString() ?? ''}\n\n${body.slice(0, 20000)}`
          const saved = await processInvoiceFile(
            { name: `${(parsed.subject ?? 'email').replace(/[^\w .-]/g, '').slice(0, 50) || 'email'}.txt`, contentType: 'text/plain', data: Buffer.from(text) },
            { source: 'email', emailMessageId: messageId, hint },
          )
          if (saved) found++
        } catch (e) {
          failed = true
          result.errors.push(`${parsed.subject ?? 'email'}: ${e instanceof Error ? e.message : 'failed'}`)
        }
      }

      result.emailsRead++
      result.invoicesFound += found
      // A failed email is retried on the next run (only if nothing from it was saved, to avoid duplicates).
      if (!failed || found > 0) {
        await supabase.from('processed_emails').insert({
          message_id: messageId,
          subject: parsed.subject ?? null,
          from_address: parsed.from?.text ?? null,
          invoices_found: found,
        })
      }
    }
  } finally {
    lock.release()
    await client.logout()
  }
  return result
}
