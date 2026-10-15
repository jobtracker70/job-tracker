import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({ variable: '--font-jakarta', subsets: ['latin'] })

export const metadata: Metadata = {
  title: { default: 'BrushBooks', template: '%s – BrushBooks' },
  description: 'Know your profit on every job.',
  appleWebApp: { capable: true, title: 'BrushBooks', statusBarStyle: 'default' },
}

export const viewport: Viewport = { themeColor: '#1D5FD8' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} h-full antialiased`}>
      <body className="min-h-full bg-page text-ink">{children}</body>
    </html>
  )
}
