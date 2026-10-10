import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServiceClient } from './supabase'
import { sendButtons, sendText, waNumber } from './whatsapp'
import { fmtClock } from './format'

type Supabase = ReturnType<typeof createServiceClient>

// Workers get a "finished for the day?" reminder this long after signing in.
export const REMIND_AFTER_HOURS = 8
// A shift still open this long after sign-in was a forgotten sign-out.
export const MAX_SHIFT_HOURS = 12
// Forgotten shifts are set to this length until the worker (or owner) gives the real finish time.
export const AUTO_CLOSE_HOURS = 8

export async function closeEntry(supabase: Supabase, entry: { id: string; start_time: string }, now = new Date()) {
  const start = new Date(entry.start_time)
  const hours = (now.getTime() - start.getTime()) / 3600000
  if (hours > MAX_SHIFT_HOURS) {
    const end = new Date(start.getTime() + AUTO_CLOSE_HOURS * 3600000)
    await supabase
      .from('time_entries')
      .update({
        end_time: end.toISOString(),
        needs_review: true,
        review_reason: `Forgot to sign out. Finish set to ${fmtClock(end)} (${AUTO_CLOSE_HOURS}h) until the real time is given.`,
      })
      .eq('id', entry.id)
    return { hours: AUTO_CLOSE_HOURS, flagged: true, end }
  }
  await supabase.from('time_entries').update({ end_time: now.toISOString() }).eq('id', entry.id)
  return { hours, flagged: false, end: now }
}

// The bot then treats the worker's next time-like reply as the real finish time for this shift.
export async function askForFinishTime(supabase: Supabase, workerId: string, entryId: string) {
  await supabase
    .from('bot_state')
    .upsert({ worker_id: workerId, kind: 'finish_time', entry_id: entryId, job_id: null, created_at: new Date().toISOString() })
}

type OpenRow = { id: string; start_time: string; worker_id: string; workers: { phone: string; active: boolean } | null; jobs: { code: string } | null }

// 8 hours after sign-in: "Finished for the day?"
export async function sendDueReminders(supabase: Supabase) {
  const cutoff = new Date(Date.now() - REMIND_AFTER_HOURS * 3600000).toISOString()
  const { data } = await supabase
    .from('time_entries')
    .select('id, start_time, worker_id, workers(phone, active), jobs(code)')
    .is('end_time', null)
    .is('reminded_at', null)
    .lte('start_time', cutoff)
  let sent = 0
  for (const e of (data ?? []) as unknown as OpenRow[]) {
    await supabase.from('time_entries').update({ reminded_at: new Date().toISOString() }).eq('id', e.id)
    if (!e.workers?.active) continue
    const ok = await sendButtons(
      waNumber(e.workers.phone),
      `You've been signed in at ${e.jobs?.code ?? 'the job'} since ${fmtClock(e.start_time)} (${REMIND_AFTER_HOURS} hours). Finished for the day?`,
      [
        { id: 'signout', title: 'Sign out now' },
        { id: 'finished_earlier', title: 'Finished earlier' },
        { id: 'still_working', title: 'Still working' },
      ],
    )
    if (ok) sent++
  }
  return sent
}

// 12 hours after sign-in with no sign-out: set 8 hours, flag it, and ask the worker for the real finish time.
export async function autoCloseStale(supabase: Supabase) {
  const cutoff = new Date(Date.now() - MAX_SHIFT_HOURS * 3600000).toISOString()
  const { data } = await supabase
    .from('time_entries')
    .select('id, start_time, worker_id, workers(phone, active), jobs(code)')
    .is('end_time', null)
    .lt('start_time', cutoff)
  for (const e of (data ?? []) as unknown as OpenRow[]) {
    const closed = await closeEntry(supabase, e)
    if (!e.workers?.active) continue
    await askForFinishTime(supabase, e.worker_id, e.id)
    await sendText(
      waNumber(e.workers.phone),
      `You didn't sign out of ${e.jobs?.code ?? 'the job'}, so I've put your finish time as ${fmtClock(closed.end)} ` +
        `(${AUTO_CLOSE_HOURS} hours after you signed in). If you finished at a different time, reply with the time, e.g. 4:30pm.`,
    )
  }
  return data?.length ?? 0
}

const sameSecret = (a: string, b: string) =>
  timingSafeEqual(createHmac('sha256', 'cmp').update(a).digest(), createHmac('sha256', 'cmp').update(b).digest())

// Scheduled calls come from the database timer (x-cron-secret, checked against a secret stored in the
// database) or from Vercel Cron (CRON_SECRET bearer if set, otherwise Vercel's scheduler user agent).
export async function cronAuthorized(req: Request) {
  const given = req.headers.get('x-cron-secret')
  if (given) {
    const { data } = await createServiceClient().from('app_settings').select('value').eq('key', 'cron_secret').maybeSingle()
    return !!data?.value && sameSecret(given, data.value)
  }
  return process.env.CRON_SECRET
    ? req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
    : (req.headers.get('user-agent') ?? '').startsWith('vercel-cron/')
}
