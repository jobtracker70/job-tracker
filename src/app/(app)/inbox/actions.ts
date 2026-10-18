'use server'

import { revalidatePath } from 'next/cache'
import { getDb, type BusinessDb } from '@/lib/db'
import { checkInbox, emailBusinessId, emailConfigured } from '@/lib/email'
import { isReadableInvoiceType, processInvoiceFile } from '@/lib/invoices'
import { isOutOfCredit } from '@/lib/ai'
import { num, text } from '@/lib/format'

// A job id from a form, only if it's this business's job
async function ownedJob(db: BusinessDb, jobId: string | null) {
  return jobId && (await db.owns('jobs', jobId)) ? jobId : null
}

function refresh() {
  revalidatePath('/inbox')
  revalidatePath('/jobs/[id]', 'layout')
  revalidatePath('/')
}

export async function uploadInvoice(_prev: string | null, formData: FormData) {
  const { db } = await getDb()
  const file = formData.get('file') as File | null
  if (!file || file.size === 0) return 'Choose a file'
  if (!isReadableInvoiceType(file.type, file.name)) return 'Upload a PDF, CSV, or photo (JPG/PNG)'
  try {
    const saved = await processInvoiceFile(
      { name: file.name, contentType: file.type || 'application/octet-stream', data: Buffer.from(await file.arrayBuffer()) },
      { source: 'upload', businessId: db.businessId, jobId: (await ownedJob(db, text(formData.get('job_id')))) ?? undefined },
    )
    refresh()
    if (!saved) return "That doesn't look like an invoice, so nothing was added."
    if (saved.duplicate) return 'Already added before — not counted twice.'
    return saved.status === 'approved' ? '✓ Added to the job automatically.' : '✓ Added — check it below.'
  } catch (e) {
    if (isOutOfCredit(e)) return "The AI account has run out of credit, so the invoice couldn't be read. Top it up, then upload again."
    return e instanceof Error ? e.message : 'Something went wrong'
  }
}

export async function checkEmailNow() {
  const { db } = await getDb()
  if (!emailConfigured() || db.businessId !== emailBusinessId()) return 'The business email is not connected yet.'
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
  const { db } = await getDb()
  const jobId = await ownedJob(db, text(formData.get('job_id')))
  const category = String(formData.get('category'))
  const workerId = text(formData.get('worker_id'))
  await db
    .from('expenses')
    .update({
      job_id: jobId,
      category: ['materials', 'subbie', 'other'].includes(category) ? category : 'other',
      worker_id: category === 'subbie' && (await db.owns('workers', workerId)) ? workerId : null,
      hours: category === 'subbie' ? num(formData.get('hours')) : null,
      total: num(formData.get('total')) ?? undefined,
      gst: num(formData.get('gst')),
      note: null,
      status: jobId ? 'approved' : 'pending',
    })
    .eq('id', expenseId)
  refresh()
}

// Move an invoice to another job (or off all jobs, back to "Needs checking")
export async function moveExpense(expenseId: string, formData: FormData) {
  const { db } = await getDb()
  const jobId = await ownedJob(db, text(formData.get('job_id')))
  await db
    .from('expenses')
    .update({ job_id: jobId, status: jobId ? 'approved' : 'pending' })
    .eq('id', expenseId)
  refresh()
  revalidatePath(`/inbox/${expenseId}`)
}

// Undo "Ignore": back to "Needs checking"
export async function restoreExpense(expenseId: string) {
  await (await getDb()).db.from('expenses').update({ status: 'pending' }).eq('id', expenseId).eq('status', 'rejected')
  refresh()
  revalidatePath(`/inbox/${expenseId}`)
}

export async function rejectExpense(expenseId: string) {
  await (await getDb()).db.from('expenses').update({ status: 'rejected' }).eq('id', expenseId)
  refresh()
}
