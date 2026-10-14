'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { uploadQuote } from './actions'
import { buttonClass, cardClass, inputClass } from '@/components/ui'

export default function NewJobPage() {
  const [error, action, pending] = useActionState(
    async (_prev: string | null, formData: FormData) => {
      try {
        await uploadQuote(formData)
        return null
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('NEXT_REDIRECT')) throw e
        return e instanceof Error ? e.message : 'Something went wrong'
      }
    },
    null,
  )
  const [fileName, setFileName] = useState<string | null>(null)

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <Link href="/?tab=quotes" className="text-brand text-sm font-medium hover:underline">← Jobs</Link>
        <h1 className="text-[28px] md:text-[32px] font-bold leading-tight mt-1">New quote</h1>
      </div>

      <form action={action} className="space-y-5">
        <label className={`${cardClass} block border-2 border-dashed !border-brand/30 hover:!border-brand p-10 text-center cursor-pointer transition`}>
          <input
            type="file"
            name="pdf"
            accept="application/pdf"
            required
            className="sr-only"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          />
          <span className="text-4xl block mb-3">📄</span>
          <span className="block font-semibold text-lg">{fileName ?? 'Tap to choose your quote PDF'}</span>
          <span className="block text-muted text-sm mt-1">{fileName ? 'Tap to choose a different file' : 'The same PDF you sent to the client'}</span>
        </label>

        <label className="block">
          <span className="font-medium">Job code <span className="text-faint font-normal">(optional, e.g. SMITH-PENRITH)</span></span>
          <input type="text" name="job_code" maxLength={24} className={`${inputClass} mt-1.5 uppercase`} />
          <span className="block text-faint text-sm mt-1">Your team puts this on invoices so costs land on the right job.</span>
        </label>

        <details className="group">
          <summary className="text-sm text-brand font-semibold cursor-pointer">More options</summary>
          <div className="grid gap-3 mt-3">
            <label className="block">
              <span className="text-sm font-medium">Client name <span className="text-faint font-normal">(BrushBooks reads it from the PDF)</span></span>
              <input type="text" name="client_name" placeholder="e.g. Smith" className={`${inputClass} mt-1.5`} />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Job address</span>
              <input type="text" name="address" placeholder="e.g. 14 Oak St, Penrith" className={`${inputClass} mt-1.5`} />
            </label>
          </div>
        </details>

        {error && <p className="bg-bad-tint text-bad rounded-xl px-4 py-3 text-sm font-medium">{error}</p>}

        <button type="submit" disabled={pending} className={`${buttonClass} w-full py-3.5 text-base`}>
          {pending ? 'Reading your quote…' : 'Add quote'}
        </button>
      </form>
    </div>
  )
}
