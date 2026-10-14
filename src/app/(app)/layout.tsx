import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase'
import { invoicesToCheckCount, shiftsToCheck } from '@/lib/checks'
import { BottomNav, SideNav } from '@/components/nav'
import { Logo, buttonClass } from '@/components/ui'
import { logout } from '../login/actions'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServiceClient()
  const [shifts, invoices] = await Promise.all([shiftsToCheck(supabase), invoicesToCheckCount(supabase)])
  const counts = { hours: shifts.length, invoices }
  const today = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Australia/Sydney' })

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop menu */}
      <aside className="hidden md:flex print:hidden w-64 shrink-0 flex-col bg-white border-r border-line px-4 py-6 sticky top-0 h-screen">
        <Link href="/" className="px-2 mb-8"><Logo /></Link>
        <SideNav counts={counts} />
        <div className="mt-auto pt-4 border-t border-line">
          <Link href="/privacy" className="block px-3 py-2 text-sm text-faint hover:text-ink">Privacy</Link>
          <form action={logout}>
            <button className="w-full text-left px-3 py-2 text-sm text-faint hover:text-ink">Log out</button>
          </form>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
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

        <main className="max-w-4xl mx-auto px-4 md:px-10 pt-5 md:pt-4 pb-28 md:pb-16">
          {children}
          <div className="md:hidden print:hidden mt-10 flex justify-center gap-6 text-sm text-faint">
            <Link href="/privacy">Privacy</Link>
            <form action={logout}><button>Log out</button></form>
          </div>
        </main>
      </div>

      <BottomNav counts={counts} />
    </div>
  )
}
