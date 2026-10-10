import { createServiceClient } from '@/lib/supabase'
import { autoCloseStale, cronAuthorized, sendDueReminders } from '@/lib/hours'

export const maxDuration = 60

// Called every 15 minutes by the database timer: 8-hour reminders, then 12-hour forgotten sign-outs.
export async function GET(req: Request) {
  if (!(await cronAuthorized(req))) return new Response('Unauthorized', { status: 401 })
  const supabase = createServiceClient()
  const reminded = await sendDueReminders(supabase)
  const autoClosed = await autoCloseStale(supabase)
  return Response.json({ reminded, autoClosed })
}
