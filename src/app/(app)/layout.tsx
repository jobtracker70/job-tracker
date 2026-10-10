import Link from 'next/link'
import { logout } from '../login/actions'

const links = [
  { href: '/', label: 'Jobs' },
  { href: '/hours', label: 'Hours' },
  { href: '/inbox', label: 'Invoices' },
  { href: '/workers', label: 'Workers' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="print:hidden border-b border-gray-800 bg-gray-950/90 sticky top-0 z-10 backdrop-blur">
        <nav className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-1 text-sm whitespace-nowrap overflow-x-auto">
          <Link href="/" className="font-bold mr-3">Job Tracker</Link>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="px-3 py-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800">
              {l.label}
            </Link>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <Link href="/jobs/new" className="bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg font-medium">+ Quote</Link>
            <form action={logout}>
              <button className="px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800">Log out</button>
            </form>
          </div>
        </nav>
      </header>
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6">{children}</main>
    </>
  )
}
