'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { checkInbox, emailConfigured } from '@/lib/email'
import { isReadableInvoiceType, processInvoiceFile } from '@/lib/invoices'
import { num, text } from '@/lib/format'

function refresh() {
  revalidatePath('/inbox')
  revalidatePath('/')
}

export async function uploadInvoice(_prev: string | null, formData: FormData) {
  await requireAuth()
  const file = formData.get('file') as File | null
  if (!file || file.size === 0) return 'Choose a file'
  if (!isReadableInvoiceType(file.type, file.name)) return 'Upload a PDF, CSV, or photo (JPG/PNG)'
  try {
    const saved = await processInvoiceFile(
      { name: file.name, contentType: file.type || 'application/octet-stream', data: Buffer.from(await file.arrayBuffer()) },
      { source: 'upload', jobId: text(formData.get('job_id')) ?? undefined },
    )
    refresh()
    if (!saved) return "That doesn't look like an invoice, so nothing was added."
    if (saved.duplicate) return 'Already added before — not counted twice.'
    return saved.status === 'approved' ? '✓ Added to the job automatically.' : '✓ Added — check it below.'
  } catch (e) {
    return e instanceof Error ? e.message : 'Something went wrong'
  }
}

export async function checkEmailNow() {
  await requireAuth()
  if (!emailConfigured()) return 'The business email is not connected yet.'
  try {
    const r = await checkInbox({ timeBudgetMs: 40000 })
    refresh()
    const more = r.leftForNextRun ? ` ${r.leftForNextRun} emails left — press again to continue.` : ''
    const errs = r.errors.length ? ` Problems: ${r.errors.join('; ')}` : ''
    return `Read ${r.emailsRead} new emails, found ${r.invoicesFound} invoices.${more}${errs}`
  } catch (e) {
    return `Couldn't read the inbox: ${e instanceof Error ? e.message : 'unknown error'}`
  }
}

export async function approveExpense(expenseId: string, formData: FormData) {
  await requireAuth()
  const jobId = text(formData.get('job_id'))
  const category = String(formData.get('category'))
  await createServiceClient()
    .from('expenses')
    .update({
      job_id: jobId,
      category: ['materials', 'subbie', 'other'].includes(category) ? category : 'other',
      worker_id: category === 'subbie' ? text(formData.get('worker_id')) : null,
      hours: category === 'subbie' ? num(formData.get('hours')) : null,
      total: num(formData.get('total')) ?? undefined,
      gst: num(formData.get('gst')),
      note: null,
      status: jobId ? 'approved' : 'pending',
    })
    .eq('id', expenseId)
  refresh()
}

export async function rejectExpense(expenseId: string) {
  await requireAuth()
  await createServiceClient().from('expenses').update({ status: 'rejected' }).eq('id', expenseId)
  refresh()
}
