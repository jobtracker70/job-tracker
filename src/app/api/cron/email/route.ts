import { checkInbox, emailConfigured } from '@/lib/email'

export const maxDuration = 60

// Called by Vercel Cron every morning (see vercel.json).
export async function GET(req: Request) {
  // With CRON_SECRET set, Vercel sends it as a bearer token. Without it, only accept Vercel's scheduler.
  const authorised = process.env.CRON_SECRET
    ? req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
    : (req.headers.get('user-agent') ?? '').startsWith('vercel-cron/')
  if (!authorised) return new Response('Unauthorized', { status: 401 })
  if (!emailConfigured()) return Response.json({ skipped: 'email not connected yet' })
  const result = await checkInbox()
  return Response.json(result)
}
