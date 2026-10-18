import Link from 'next/link'
import { getDb } from '@/lib/db'
import { invoicesToCheckCount, shiftsToCheck } from '@/lib/checks'
import { BottomNav, SideNav } from '@/components/nav'
import { Logo, buttonClass } from '@/components/ui'
import { logout } from '../login/actions'
import { AskAI } from '@/components/ask-ai'
import { backToMyBusiness } from './admin/actions'

// The AI assistant can take a few seconds to look things up
export const maxDuration = 60

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { db, session } = await getDb()
  const viewingOther = session.businessId !== session.ownBusinessId
  const [shifts, invoices] = await Promise.all([shiftsToCheck(db), invoicesToCheckCount(db)])
  const counts = { hours: shifts.length, invoices }
  const today = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Australia/Sydney' })

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop menu */}
      <aside className="hidden md:flex print:hidden w-64 shrink-0 flex-col bg-white border-r border-line px-4 py-6 sticky top-0 h-screen">
        <Link href="/" className="px-2 mb-8"><Logo /></Link>
        <SideNav counts={counts} />
        <div className="mt-auto pt-4 border-t border-line">
          <p className="px-3 pb-2 text-sm">
            <span className="block font-semibold truncate">{session.businessName}</span>
            <span className="block text-faint truncate">{session.name ?? session.email}</span>
          </p>
          {session.isAdmin && <Link href="/admin" className="block px-3 py-2 text-sm font-semibold text-brand hover:text-brand-dark">Admin</Link>}
          <Link href="/account" className="block px-3 py-2 text-sm text-faint hover:text-ink">My account &amp; password</Link>
          <Link href="/privacy" className="block px-3 py-2 text-sm text-faint hover:text-ink">Privacy</Link>
          <form action={logout}>
            <button className="w-full text-left px-3 py-2 text-sm text-faint hover:text-ink">Log out</button>
          </form>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        {viewingOther && (
          <div className="print:hidden bg-warn-tint border-b border-warn/20 px-4 md:px-10 py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-warn font-semibold">You&apos;re viewing {session.businessName}&apos;s account. Changes you make are saved in their account.</span>
            <form action={backToMyBusiness}><button className="font-semibold text-brand">Back to my business →</button></form>
          </div>
        )}
        {/* Phone top bar */}
        <header className="md:hidden print:hidden sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-line px-4 h-14 flex items-center justify-between">
          <Link href="/"><Logo size={30} /></Link>
          <Link href="/jobs/new" className={`${buttonClass} !px-3 !py-2`}>+ Quote</Link>
        </header>

        {/* Desktop top row */}
        <div className="hidden md:flex print:hidden items-center justify-between px-10 pt-6">
          <p className="text-muted text-sm">{today}</p>
          <Link href="/jobs/new" className={buttonClass}>+ New quote</Link>
        </div>

        <main className="max-w-6xl mx-auto px-4 md:px-10 pt-5 md:pt-4 pb-28 md:pb-16">
          {children}
          <p className="md:hidden print:hidden mt-10 text-center text-sm text-faint">{session.businessName} · {session.name ?? session.email}</p>
          <div className="md:hidden print:hidden mt-2 flex justify-center gap-6 text-sm text-faint">
            {session.isAdmin && <Link href="/admin" className="text-brand font-semibold">Admin</Link>}
            <Link href="/account">My account</Link>
            <Link href="/privacy">Privacy</Link>
            <form action={logout}><button>Log out</button></form>
          </div>
        </main>
      </div>

      <BottomNav counts={counts} />
      <AskAI />
    </div>
  )
}
