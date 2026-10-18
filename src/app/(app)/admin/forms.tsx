'use client'

import { useActionState, useState } from 'react'
import { addPerson, createClientAccount, newPassword, type AdminResult } from './actions'
import { buttonClass, inputClass, secondaryButtonClass } from '@/components/ui'

// Shows a new login once, ready to send to the client
function LoginCard({ result }: { result: AdminResult }) {
  const [copied, setCopied] = useState(false)
  if (!result) return null
  if (!result.ok) return <p className="text-bad text-sm font-medium">{result.message}</p>
  const note = result.password
    ? `BrushBooks login\nWebsite: ${typeof window === 'undefined' ? '' : window.location.origin}/login\nEmail: ${result.email}\nPassword: ${result.password}`
    : ''
  return (
    <div className="bg-good-tint border border-good/20 rounded-xl p-3 space-y-2 text-sm">
      <p className="font-semibold text-good">✓ {result.message}</p>
      {result.password && (
        <>
          <pre className="bg-white border border-line rounded-lg p-2.5 whitespace-pre-wrap font-mono text-[13px]">{note}</pre>
          <p className="text-muted text-xs">Shown once only. Send it to them now (text or email). They can&apos;t see it again, but you can make a new one.</p>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(note).then(() => setCopied(true))}
            className={secondaryButtonClass}
          >
            {copied ? 'Copied ✓' : 'Copy login details'}
          </button>
        </>
      )}
    </div>
  )
}

export function NewClientForm() {
  const [result, action, pending] = useActionState(createClientAccount, null)
  return (
    <form action={action} className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block"><span className="text-sm font-medium">Business name</span>
          <input name="business_name" required placeholder="e.g. Smith Painting" className={`${inputClass} mt-1.5`} /></label>
        <label className="block"><span className="text-sm font-medium">Owner&apos;s name</span>
          <input name="owner_name" placeholder="e.g. John Smith" className={`${inputClass} mt-1.5`} /></label>
        <label className="block sm:col-span-2"><span className="text-sm font-medium">Owner&apos;s email (their login)</span>
          <input name="email" type="email" required className={`${inputClass} mt-1.5`} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="sample" defaultChecked className="w-4 h-4 accent-[var(--color-brand)]" />
        Copy in the sample jobs so they can look around (they can delete them later)
      </label>
      <button disabled={pending} className={buttonClass}>{pending ? 'Setting up… (up to 30 seconds)' : 'Create client account'}</button>
      <LoginCard result={result} />
    </form>
  )
}

export function AddPersonForm({ businessId }: { businessId: string }) {
  const [result, action, pending] = useActionState(addPerson.bind(null, businessId), null)
  return (
    <form action={action} className="space-y-2">
      <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
        <input name="name" placeholder="Name" className={inputClass} />
        <input name="email" type="email" required placeholder="Email" className={inputClass} />
        <select name="role" defaultValue="staff" className={inputClass}>
          <option value="owner">Owner</option>
          <option value="staff">Office / staff</option>
        </select>
      </div>
      <button disabled={pending} className={secondaryButtonClass}>{pending ? 'Adding…' : 'Add login'}</button>
      <LoginCard result={result} />
    </form>
  )
}

export function ResetPasswordButton({ userId, email }: { userId: string; email: string }) {
  const [result, setResult] = useState<AdminResult>(null)
  const [pending, setPending] = useState(false)
  const [asking, setAsking] = useState(false)
  return (
    <div className="space-y-2">
      {!asking ? (
        <button type="button" onClick={() => setAsking(true)} className="text-brand text-sm font-semibold">New password</button>
      ) : !result ? (
        <span className="flex items-center gap-2 text-sm">
          Make a new password for {email}? The old one stops working.
          <button
            type="button"
            disabled={pending}
            onClick={async () => { setPending(true); setResult(await newPassword(userId, email)); setPending(false) }}
            className="text-bad font-semibold"
          >
            {pending ? 'Making…' : 'Yes'}
          </button>
          <button type="button" onClick={() => setAsking(false)} className="text-muted">Cancel</button>
        </span>
      ) : null}
      <LoginCard result={result} />
    </div>
  )
}
