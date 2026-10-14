'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Counts = { hours: number; invoices: number }

const ICONS = {
  jobs: 'M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8Zm5-3h6v3H9V5Z',
  hours: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm0 4v5l3 2',
  invoices: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6M9 16h3',
  workers: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10a7 7 0 0 1 14 0M17 11a3 3 0 1 0-1-5.8M22 21a6 6 0 0 0-4-5.6',
}

const ITEMS = [
  { href: '/', label: 'Jobs', icon: ICONS.jobs, match: (p: string) => p === '/' || p.startsWith('/jobs') },
  { href: '/hours', label: 'Hours', icon: ICONS.hours, count: 'hours' as const, match: (p: string) => p.startsWith('/hours') },
  { href: '/inbox', label: 'Invoices', icon: ICONS.invoices, count: 'invoices' as const, match: (p: string) => p.startsWith('/inbox') },
  { href: '/workers', label: 'Workers', icon: ICONS.workers, match: (p: string) => p.startsWith('/workers') },
]

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}

export function SideNav({ counts }: { counts: Counts }) {
  const path = usePathname()
  return (
    <nav className="space-y-1">
      {ITEMS.map((it) => {
        const active = it.match(path)
        const n = it.count ? counts[it.count] : 0
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 font-semibold transition ${
              active ? 'bg-brand-tint text-brand' : 'text-muted hover:bg-page hover:text-ink'
            }`}
          >
            <Icon d={it.icon} />
            <span className="flex-1">{it.label}</span>
            {n > 0 && <span className="min-w-6 h-6 px-1.5 rounded-full bg-bad text-white text-xs font-bold grid place-items-center">{n}</span>}
          </Link>
        )
      })}
    </nav>
  )
}

export function BottomNav({ counts }: { counts: Counts }) {
  const path = usePathname()
  return (
    <nav className="md:hidden print:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-line grid grid-cols-4 pb-[env(safe-area-inset-bottom)]">
      {ITEMS.map((it) => {
        const active = it.match(path)
        const n = it.count ? counts[it.count] : 0
        return (
          <Link key={it.href} href={it.href} className={`relative flex flex-col items-center gap-0.5 py-2.5 text-xs font-semibold ${active ? 'text-brand' : 'text-faint'}`}>
            <Icon d={it.icon} />
            {it.label}
            {n > 0 && (
              <span className="absolute top-1.5 left-1/2 ml-2 min-w-5 h-5 px-1 rounded-full bg-bad text-white text-[11px] font-bold grid place-items-center">{n}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
