'use client'

import { useActionState, useState } from 'react'
import { uploadVariation } from './actions'
import { inputClass, secondaryButtonClass } from '@/components/ui'

// Upload the quote you sent for extra work; its price, hours and materials become an extra on the job
export function VariationUpload({ jobId }: { jobId: string }) {
  const [message, action, pending] = useActionState(uploadVariation.bind(null, jobId), null)
  const [name, setName] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  return (
    <form action={action} className="space-y-2 mb-4">
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={() => setOver(false)}
        className={`relative block border-2 border-dashed rounded-xl px-4 py-4 text-center text-sm cursor-pointer transition ${over ? 'border-brand bg-brand-tint' : 'border-line hover:border-brand/50'}`}
      >
        <input
          type="file"
          name="pdf"
          accept="application/pdf"
          required
          className="absolute inset-0 opacity-0 cursor-pointer"
          onChange={(e) => setName(e.target.files?.[0]?.name ?? null)}
        />
        <span className="font-semibold">{name ?? 'Upload a variation quote (PDF)'}</span>
        <span className="block text-faint">{name ? 'Tap to choose a different file' : 'Drag it here or tap to choose. The price is read for you.'}</span>
      </label>
      {name && <input name="description" placeholder="What's the extra work? (optional, read from the PDF)" className={inputClass} />}
      {name && <button disabled={pending} className={`${secondaryButtonClass} w-full`}>{pending ? 'Reading the quote…' : 'Add as an extra'}</button>}
      {message && <p className={`text-sm font-medium ${message.startsWith('✓') ? 'text-good' : 'text-bad'}`}>{message}</p>}
    </form>
  )
}
