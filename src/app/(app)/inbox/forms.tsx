'use client'

import { useActionState } from 'react'
import { checkEmailNow, uploadInvoice } from './actions'
import { buttonClass, inputClass, secondaryButtonClass } from '@/components/ui'

export function UploadInvoiceForm({ jobs }: { jobs: { id: string; code: string; client_name: string | null }[] }) {
  const [message, action, pending] = useActionState(uploadInvoice, null)
  return (
    <form action={action} className="space-y-3">
      <input type="file" name="file" required accept="application/pdf,text/csv,.csv,image/jpeg,image/png,image/webp" className="block w-full text-sm text-gray-300 file:mr-3 file:bg-gray-800 file:border-0 file:px-3 file:py-2 file:rounded-lg file:text-white" />
      <select name="job_id" defaultValue="" className={inputClass}>
        <option value="">Job: work it out from the invoice</option>
        {jobs.map((j) => (
          <option key={j.id} value={j.id}>{j.code} — {j.client_name ?? 'Unnamed'}</option>
        ))}
      </select>
      <button disabled={pending} className={buttonClass}>{pending ? 'Reading invoice…' : 'Upload invoice'}</button>
      {message && <p className="text-sm text-gray-300">{message}</p>}
    </form>
  )
}

export function CheckEmailButton({ connected }: { connected: boolean }) {
  const [message, action, pending] = useActionState(checkEmailNow, null)
  return (
    <form action={action} className="space-y-2">
      <button disabled={pending || !connected} className={secondaryButtonClass}>
        {pending ? 'Reading emails… (up to a minute)' : 'Check email now'}
      </button>
      {message && <p className="text-sm text-gray-300">{message}</p>}
    </form>
  )
}
