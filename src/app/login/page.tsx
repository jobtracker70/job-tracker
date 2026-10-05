'use client'

import { useActionState } from 'react'
import { login } from './actions'

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, null)

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form action={action} className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold">Job Tracker</h1>
          <p className="text-gray-400 text-sm">Enter your password to continue.</p>
        </div>
        <input
          type="password"
          name="password"
          required
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500"
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 py-2.5 rounded-lg font-semibold transition"
        >
          {pending ? 'Checking…' : 'Log in'}
        </button>
      </form>
    </main>
  )
}
