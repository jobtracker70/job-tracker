import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE, isValidSession } from '@/lib/auth'

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname
  if (path === '/login') return NextResponse.next()
  if (isValidSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next()
  // Visitors to the home page see the BrushBooks website; everything else needs a login
  if (path === '/') return NextResponse.rewrite(new URL('/welcome', req.url))
  return NextResponse.redirect(new URL('/login', req.url))
}

// WhatsApp and the scheduled jobs are called by outside services and check their own secrets.
// The website (/welcome), its screenshots and /privacy are public.
export const config = {
  matcher: ['/((?!api/whatsapp|api/cron|privacy|welcome|screens|manifest.webmanifest|icon|apple-icon|_next/static|_next/image|favicon.ico).*)'],
}
