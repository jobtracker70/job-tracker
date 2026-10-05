'use client'

import { useActionState, useRef } from 'react'
import Link from 'next/link'
import { uploadQuote } from './actions'

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
    null
  )

  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-xl mx-auto">
        <div className="mb-8">
          <Link href="/" className="text-gray-400 hover:text-white text-sm">← Back</Link>
          <h1 className="text-2xl font-bold mt-4">New Job from Quote</h1>
          <p className="text-gray-400 text-sm mt-1">Upload a PDF quote — Claude will read it and create the job automatically.</p>
        </div>

        <form action={action} className="space-y-5">
          {/* PDF Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Quote PDF <span className="text-red-400">*</span>
            </label>
            <div
              className="border-2 border-dashed border-gray-700 rounded-xl p-8 text-center cursor-pointer hover:border-blue-500 transition"
              onClick={() => fileRef.current?.click()}
            >
              <div className="text-4xl mb-2">📄</div>
              <p className="text-gray-400 text-sm">Click to choose a PDF file</p>
              <input
                ref={fileRef}
                type="file"
                name="pdf"
                accept="application/pdf"
                required
                className="hidden"
                onChange={(e) => {
                  const label = e.target.nextElementSibling as HTMLElement | null
                  if (label && e.target.files?.[0]) {
                    label.textContent = e.target.files[0].name
                  }
                }}
              />
              <p className="text-blue-400 text-sm mt-2 font-medium"></p>
            </div>
          </div>

          {/* Optional overrides */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Client name <span className="text-gray-500">(optional — Claude will detect it)</span>
            </label>
            <input
              type="text"
              name="client_name"
              placeholder="e.g. Smith Residence"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Job address <span className="text-gray-500">(optional)</span>
            </label>
            <input
              type="text"
              name="address"
              placeholder="e.g. 14 Oak St, Penrith NSW"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed py-3 rounded-lg font-semibold transition"
          >
            {pending ? 'Reading quote…' : 'Create Job'}
          </button>
        </form>
      </div>
    </main>
  )
}
