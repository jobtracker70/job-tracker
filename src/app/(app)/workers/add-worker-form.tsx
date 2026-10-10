'use client'

import { useActionState, useState } from 'react'
import { addWorker } from './actions'
import { buttonClass, inputClass } from '@/components/ui'

export const WORKER_TYPES = [
  { value: 'employee', label: 'Employee' },
  { value: 'apprentice', label: 'Apprentice' },
  { value: 'subbie', label: 'Subbie — hourly (sends invoices with hours)' },
  { value: 'subbie_fixed', label: 'Subbie — fixed price (per job / per m²)' },
]

export function RateFields({ type, defaults }: { type: string; defaults?: { oncost?: number; overtimeAfter?: number } }) {
  const subbie = type === 'subbie' || type === 'subbie_fixed'
  if (type === 'subbie_fixed') return null
  return (
    <>
      <label className="text-sm">
        <span className="text-gray-300">{subbie ? 'Hourly rate they charge ($, ex GST)' : 'Normal hourly pay rate ($)'}</span>
        <input name="rate" inputMode="decimal" placeholder="e.g. 45" className={`${inputClass} mt-1`} />
      </label>
      {!subbie && (
        <>
          <label className="text-sm">
            <span className="text-gray-300">On-costs multiplier <span className="text-gray-500">(super, insurance…)</span></span>
            <input name="oncost" inputMode="decimal" defaultValue={String(defaults?.oncost ?? 1.4)} className={`${inputClass} mt-1`} />
          </label>
          <label className="text-sm">
            <span className="text-gray-300">Weekend rate ($/h) <span className="text-gray-500">— blank if same</span></span>
            <input name="weekend_rate" inputMode="decimal" placeholder="same as normal" className={`${inputClass} mt-1`} />
          </label>
          <label className="text-sm">
            <span className="text-gray-300">Overtime rate ($/h) <span className="text-gray-500">— blank if same</span></span>
            <input name="overtime_rate" inputMode="decimal" placeholder="same as normal" className={`${inputClass} mt-1`} />
          </label>
          <label className="text-sm">
            <span className="text-gray-300">Overtime starts after (hours a day)</span>
            <input name="overtime_after" inputMode="decimal" defaultValue={String(defaults?.overtimeAfter ?? 8)} className={`${inputClass} mt-1`} />
          </label>
        </>
      )}
    </>
  )
}

export function AddWorkerForm() {
  const [error, action, pending] = useActionState(addWorker, null)
  const [type, setType] = useState('employee')
  const subbie = type === 'subbie' || type === 'subbie_fixed'

  return (
    <form action={action} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
      <label className="text-sm">
        <span className="text-gray-300">Name</span>
        <input name="name" required className={`${inputClass} mt-1`} />
      </label>
      <label className="text-sm">
        <span className="text-gray-300">WhatsApp number</span>
        <input name="phone" required placeholder="0412 345 678" className={`${inputClass} mt-1`} />
      </label>
      <label className="text-sm">
        <span className="text-gray-300">Type</span>
        <select name="type" value={type} onChange={(e) => setType(e.target.value)} className={`${inputClass} mt-1`}>
          {WORKER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <RateFields type={type} />
      <label className="text-sm">
        <span className="text-gray-300">Unpaid break (minutes)</span>
        <input name="break_minutes" inputMode="numeric" defaultValue="0" className={`${inputClass} mt-1`} />
        <span className="text-gray-500 text-xs">0 = all hours paid. 30 = 30 min unpaid, taken off once a day (days over 5 hours).</span>
      </label>
      {subbie && (
        <label className="text-sm">
          <span className="text-gray-300">ABN <span className="text-gray-500">(helps match their invoices)</span></span>
          <input name="abn" className={`${inputClass} mt-1`} />
        </label>
      )}
      {type === 'subbie_fixed' && (
        <p className="text-gray-500 text-xs md:col-span-3">
          Fixed-price subbies are costed from their invoices. Their WhatsApp sign-ins are recorded for your information, but
          their invoices don&apos;t need hours.
        </p>
      )}
      <button disabled={pending} className={`${buttonClass} md:col-start-3`}>{pending ? 'Adding…' : 'Add worker'}</button>
      {error && <p className="text-red-400 text-sm md:col-span-3">{error}</p>}
    </form>
  )
}
