'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { buttonClass, cardClass, inputClass } from '@/components/ui'
import { moneyCents } from '@/lib/format'
import { fmtQty, itemValue, type LineItem } from '@/lib/items'
import { moveItems } from '../actions'

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return <button disabled={disabled || pending} className={`${buttonClass} disabled:opacity-50`}>{pending ? 'Moving…' : 'Move these items'}</button>
}

// Tick the products that belong to another job and send them there
export function MoveItems({ expenseId, items, jobs, amountExGst, onAJob }: {
  expenseId: string
  items: LineItem[]
  jobs: { id: string; code: string; address: string | null }[]
  amountExGst: number
  onAJob: boolean
}) {
  const [picked, setPicked] = useState<number[]>([])
  const [job, setJob] = useState('')
  const value = (list: LineItem[]) => list.reduce((s, i) => s + (itemValue(i) ?? 0), 0)
  const priced = value(items)
  const moving = priced ? (amountExGst * value(items.filter((_, k) => picked.includes(k)))) / priced : 0
  const toggle = (k: number) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))

  return (
    <details className={`${cardClass} group`}>
      <summary className="px-5 py-4 cursor-pointer font-semibold text-brand">Bought for more than one job? Move items</summary>
      <form action={moveItems.bind(null, expenseId)} className="px-5 pb-5 space-y-3">
        <p className="text-sm text-muted">Tick the items that belong to another job. The rest stay here.</p>
        <div className="divide-y divide-line">
          {items.map((i, k) => {
            const price = itemValue(i)
            return (
              <label key={k} className={`flex items-start gap-3 py-2.5 text-sm ${price == null ? 'opacity-50' : 'cursor-pointer'}`}>
                <input type="checkbox" name="item" value={k} disabled={price == null} checked={picked.includes(k)} onChange={() => toggle(k)} className="mt-0.5 size-5 shrink-0 accent-brand" />
                <span className="flex-1 min-w-0">{i.description}{i.qty != null && <span className="text-muted"> × {fmtQty(i.qty)}</span>}</span>
                <span className="font-medium whitespace-nowrap">{price == null ? 'No price' : moneyCents(price)}</span>
              </label>
            )
          })}
        </div>
        <label className="block max-w-md">
          <span className="text-sm font-medium">Move to</span>
          <select name="job_id" required value={job} onChange={(e) => setJob(e.target.value)} className={`${inputClass} mt-1`}>
            <option value="" disabled>Choose a job</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.address ?? j.code}</option>)}
            {onAJob && <option value="none">Not on any job (Needs checking)</option>}
          </select>
        </label>
        {picked.length > 0 && <p className="text-sm">About <strong>{moneyCents(moving)}</strong> ex GST moves off this job.</p>}
        <Submit disabled={!picked.length || !job} />
      </form>
    </details>
  )
}
