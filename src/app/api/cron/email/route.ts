import { checkInbox, emailConfigured } from '@/lib/email'

export const maxDuration = 60

// Called by Vercel Cron every morning (see vercel.json). Vercel sends the CRON_SECRET as a bearer token.
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  if (!emailConfigured()) return Response.json({ skipped: 'email not connected yet' })
  const result = await checkInbox()
  return Response.json(result)
}
