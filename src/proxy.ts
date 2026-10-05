import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE, isValidSession } from '@/lib/auth'

export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname === '/login') return NextResponse.next()
  if (isValidSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next()
  return NextResponse.redirect(new URL('/login', req.url))
}

// WhatsApp and the morning email job are called by outside services and check their own secrets.
export const config = {
  matcher: ['/((?!api/whatsapp|api/cron|_next/static|_next/image|favicon.ico).*)'],
}
