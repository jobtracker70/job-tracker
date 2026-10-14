'use client'

import { useActionState, useState } from 'react'
import { addWorker } from './actions'
import { buttonClass, inputClass } from '@/components/ui'
import { WORKER_TYPES } from '@/lib/workers'

const isSubbie = (t: string) => t === 'subbie' || t === 'subbie_fixed'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  )
}

// Extra pay settings, hidden until needed
export function PayOptions({ type, defaults }: { type: string; defaults?: { oncost?: number; overtimeAfter?: number; breakMinutes?: number; abn?: string | null } }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {!isSubbie(type) && (
        <>
          <Field label="Weekend rate ($/h)"><input name="weekend_rate" inputMode="decimal" placeholder="Same as normal" className={inputClass} /></Field>
          <Field label="Overtime rate ($/h)"><input name="overtime_rate" inputMode="decimal" placeholder="Same as normal" className={inputClass} /></Field>
          <Field label="Overtime after (hours a day)"><input name="overtime_after" inputMode="decimal" defaultValue={String(defaults?.overtimeAfter ?? 8)} className={inputClass} /></Field>
          <Field label="On-costs (super, insurance)"><input name="oncost" inputMode="decimal" defaultValue={String(defaults?.oncost ?? 1.4)} className={inputClass} /></Field>
        </>
      )}
      {defaults?.breakMinutes === undefined && (
        <Field label="Unpaid break (minutes)"><input name="break_minutes" inputMode="numeric" defaultValue="0" className={inputClass} /></Field>
      )}
      {isSubbie(type) && defaults?.abn === undefined && (
        <Field label="ABN (matches their invoices)"><input name="abn" className={inputClass} /></Field>
      )}
    </div>
  )
}

export function AddWorkerForm() {
  const [error, action, pending] = useActionState(addWorker, null)
  const [type, setType] = useState('employee')
  return (
    <form action={action} className="space-y-3">
      <Field label="Name"><input name="name" required className={inputClass} /></Field>
      <Field label="WhatsApp number"><input name="phone" required inputMode="tel" placeholder="0412 345 678" className={inputClass} /></Field>
      <Field label="Type">
        <select name="type" value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
          {WORKER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>
      {type !== 'subbie_fixed' && (
        <Field label={isSubbie(type) ? 'Hourly rate they charge ($, ex GST)' : 'Pay rate ($ per hour)'}>
          <input name="rate" inputMode="decimal" placeholder="e.g. 33" className={inputClass} />
        </Field>
      )}
      <details className="group">
        <summary className="text-sm text-brand font-semibold cursor-pointer">More pay options</summary>
        <div className="mt-3">
          <PayOptions type={type} />
          <p className="text-faint text-xs mt-2">Unpaid break: 0 means all hours are paid. 30 takes 30 minutes off each day over 5 hours.</p>
        </div>
      </details>
      {error && <p className="text-bad text-sm font-medium">{error}</p>}
      <button disabled={pending} className={`${buttonClass} w-full`}>{pending ? 'Adding…' : 'Add worker'}</button>
    </form>
  )
}
