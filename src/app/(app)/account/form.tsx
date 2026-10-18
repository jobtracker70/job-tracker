'use client'

import { useActionState } from 'react'
import { changePassword } from './actions'
import { buttonClass, inputClass } from '@/components/ui'

export function ChangePasswordForm() {
  const [result, action, pending] = useActionState(changePassword, null)
  return (
    <form action={action} className="space-y-3 max-w-sm">
      <label className="block"><span className="text-sm font-medium">Current password</span>
        <input type="password" name="current" required autoComplete="current-password" className={`${inputClass} mt-1.5`} /></label>
      <label className="block"><span className="text-sm font-medium">New password (at least 8 characters)</span>
        <input type="password" name="new" required minLength={8} autoComplete="new-password" className={`${inputClass} mt-1.5`} /></label>
      <label className="block"><span className="text-sm font-medium">New password again</span>
        <input type="password" name="again" required minLength={8} autoComplete="new-password" className={`${inputClass} mt-1.5`} /></label>
      <button disabled={pending} className={buttonClass}>{pending ? 'Saving…' : 'Change password'}</button>
      {result && <p className={`text-sm font-medium ${result.ok ? 'text-good' : 'text-bad'}`}>{result.message}</p>}
    </form>
  )
}
