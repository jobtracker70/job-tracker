import { createServiceClient } from '@/lib/supabase'
import { checkInbox, emailConfigured } from '@/lib/email'
import { autoCloseStale, cronAuthorized } from '@/lib/hours'

export const maxDuration = 60

// Every morning: catch any forgotten sign-outs the 15-minute timer missed, then read the receipts inbox.
export async function GET(req: Request) {
  if (!(await cronAuthorized(req))) return new Response('Unauthorized', { status: 401 })
  const autoClosed = await autoCloseStale(createServiceClient())
  const email = emailConfigured() ? await checkInbox() : { skipped: 'email not connected yet' }
  return Response.json({ autoClosed, email })
}
