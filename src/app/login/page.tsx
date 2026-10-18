'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { login } from './actions'
import { Logo, buttonClass, cardClass, inputClass } from '@/components/ui'

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, null)

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <Logo size={44} />
      <p className="text-muted mt-2 mb-6">Know your profit on every job.</p>
      <form action={action} className={`${cardClass} w-full max-w-sm p-6 space-y-4`}>
        <h1 className="text-lg font-bold">Log in</h1>
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input type="email" name="email" required autoFocus autoComplete="email" inputMode="email" className={`${inputClass} mt-1.5`} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Password</span>
          <input type="password" name="password" required autoComplete="current-password" className={`${inputClass} mt-1.5`} />
        </label>
        {error && <p className="text-bad text-sm font-medium">{error}</p>}
        <button type="submit" disabled={pending} className={`${buttonClass} w-full py-3`}>
          {pending ? 'Checking…' : 'Log in'}
        </button>
      </form>
      <p className="text-faint text-sm mt-6">Forgot your password? Ask the person who set up your account.</p>
      <Link href="/privacy" className="text-faint text-sm mt-2 hover:text-ink">Privacy</Link>
    </main>
  )
}
