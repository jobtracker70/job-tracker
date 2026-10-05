'use client'

import { useActionState, useState } from 'react'
import { addWorker } from './actions'
import { buttonClass, inputClass } from '@/components/ui'

export function AddWorkerForm() {
  const [error, action, pending] = useActionState(addWorker, null)
  const [type, setType] = useState('employee')

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
          <option value="employee">Employee</option>
          <option value="apprentice">Apprentice</option>
          <option value="subbie">Subbie (sends invoices)</option>
        </select>
      </label>
      <label className="text-sm">
        <span className="text-gray-300">{type === 'subbie' ? 'Hourly rate they charge ($)' : 'Hourly pay rate ($)'}</span>
        <input name="rate" inputMode="decimal" placeholder="e.g. 45" className={`${inputClass} mt-1`} />
      </label>
      {type === 'subbie' ? (
        <label className="text-sm">
          <span className="text-gray-300">ABN <span className="text-gray-500">(helps match their invoices)</span></span>
          <input name="abn" className={`${inputClass} mt-1`} />
        </label>
      ) : (
        <label className="text-sm">
          <span className="text-gray-300">On-costs multiplier <span className="text-gray-500">(super, insurance…)</span></span>
          <input name="oncost" inputMode="decimal" defaultValue="1.4" className={`${inputClass} mt-1`} />
        </label>
      )}
      <button disabled={pending} className={buttonClass}>{pending ? 'Adding…' : 'Add worker'}</button>
      {error && <p className="text-red-400 text-sm md:col-span-3">{error}</p>}
    </form>
  )
}
