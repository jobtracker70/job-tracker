'use client'

import { useActionState } from 'react'
import { checkEmailNow, uploadInvoice } from './actions'
import { buttonClass, inputClass } from '@/components/ui'

type JobOption = { id: string; code: string; client_name: string | null; address: string | null }

export function UploadInvoiceForm({ jobs }: { jobs: JobOption[] }) {
  const [message, action, pending] = useActionState(uploadInvoice, null)
  return (
    <form action={action} className="space-y-3">
      <input
        type="file"
        name="file"
        required
        accept="application/pdf,text/csv,.csv,image/jpeg,image/png,image/webp"
        className="block w-full text-sm text-muted file:mr-3 file:bg-brand-tint file:text-brand file:font-semibold file:border-0 file:px-3 file:py-2 file:rounded-xl"
      />
      <select name="job_id" defaultValue="" className={inputClass}>
        <option value="">Which job? (or let BrushBooks work it out)</option>
        {jobs.map((j) => (
          <option key={j.id} value={j.id}>{j.address ?? j.client_name ?? j.code} ({j.code})</option>
        ))}
      </select>
      <button disabled={pending} className={`${buttonClass} w-full`}>{pending ? 'Reading invoice…' : 'Upload'}</button>
      {message && <p className="text-sm font-medium">{message}</p>}
    </form>
  )
}

export function CheckEmailButton({ connected }: { connected: boolean }) {
  const [message, action, pending] = useActionState(checkEmailNow, null)
  return (
    <form action={action} className="inline">
      <button disabled={pending || !connected} className="text-brand text-sm font-semibold disabled:text-faint">
        {pending ? 'Checking… (up to a minute)' : 'Check now'}
      </button>
      {message && <span className="block text-sm mt-1">{message}</span>}
    </form>
  )
}
