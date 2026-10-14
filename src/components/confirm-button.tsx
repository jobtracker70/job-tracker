'use client'

import { useState } from 'react'
import { dangerButtonClass, secondaryButtonClass } from './ui'

// A button for things that can't be undone: it asks "Are you sure?" before it submits its form
export function ConfirmButton({ label, question, confirmLabel = 'Yes, delete', className = dangerButtonClass, tone = 'bad', formAction, formNoValidate }: {
  label: string
  question: string
  confirmLabel?: string
  className?: string
  tone?: 'bad' | 'brand'
  formAction?: (formData: FormData) => void | Promise<void>
  formNoValidate?: boolean
}) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return <button type="button" onClick={() => setAsking(true)} className={className}>{label}</button>
  }
  const box = tone === 'bad' ? 'bg-bad-tint border-bad/20 text-bad' : 'bg-brand-tint border-brand/20 text-ink'
  const yes = tone === 'bad' ? 'bg-bad' : 'bg-brand'
  return (
    <div className={`border rounded-xl p-3 space-y-2.5 col-span-full ${box}`}>
      <p className="text-sm font-semibold">{question}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" formAction={formAction} formNoValidate={formNoValidate} className={`inline-flex items-center justify-center ${yes} text-white px-4 py-2.5 rounded-xl font-semibold text-sm`}>
          {confirmLabel}
        </button>
        <button type="button" onClick={() => setAsking(false)} className={secondaryButtonClass}>Cancel</button>
      </div>
    </div>
  )
}
