'use client'

import { useState } from 'react'
import { dangerButtonClass, secondaryButtonClass } from './ui'

// A delete button that asks "Are you sure?" before it submits its form
export function ConfirmButton({ label, question, confirmLabel = 'Yes, delete', className = dangerButtonClass }: {
  label: string; question: string; confirmLabel?: string; className?: string
}) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return <button type="button" onClick={() => setAsking(true)} className={className}>{label}</button>
  }
  return (
    <div className="bg-bad-tint border border-bad/20 rounded-xl p-3 space-y-2.5">
      <p className="text-sm font-semibold text-bad">{question}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="inline-flex items-center justify-center bg-bad text-white px-4 py-2.5 rounded-xl font-semibold text-sm">{confirmLabel}</button>
        <button type="button" onClick={() => setAsking(false)} className={secondaryButtonClass}>Cancel</button>
      </div>
    </div>
  )
}
