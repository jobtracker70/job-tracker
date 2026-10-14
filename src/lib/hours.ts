import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServiceClient } from './supabase'
import { sendButtons, sendText, waNumber } from './whatsapp'
import { fmtClock, fmtDuration, sydneyDateOf, sydneyTimeOn, timeToMinutes } from './format'

type Supabase = ReturnType<typeof createServiceClient>

// Workers still signed in this long after signing in get a "did you forget to sign out?" reminder.
export const REMIND_AFTER_HOURS = 13
// A shift still open this long after sign-in was a forgotten sign-out.
export const MAX_SHIFT_HOURS = 16
// Forgotten shifts with no usual finish time are set to this length until the real time is given.
export const AUTO_CLOSE_HOURS = 8

// Usual site hours when a job has none set
export const DEFAULT_START = 7 * 60
export const DEFAULT_END = 15 * 60 + 30
// Signing in up to this early counts from the usual start time
export const EARLY_GRACE_MIN = 30
// Signing out up to this late counts as the usual finish time; later than this, the worker is asked to confirm
export const LATE_GRACE_MIN = 20

// The job's usual start / finish on the Sydney day of `ts`
export const usualStart = (ts: string | Date, dayStart?: string | null) =>
  sydneyTimeOn(sydneyDateOf(ts), timeToMinutes(dayStart, DEFAULT_START))
export const usualFinish = (ts: string | Date, dayEnd?: string | null) =>
  sydneyTimeOn(sydneyDateOf(ts), timeToMinutes(dayEnd, DEFAULT_END))

export const roundToQuarter = (d: Date) => new Date(Math.round(d.getTime() / 900000) * 900000)

// When a sign-in at `now` should count from: up to 30 minutes early counts from the usual start.
export function startTimeFor(now: Date, dayStart?: string | null) {
  const usual = usualStart(now, dayStart)
  if (!usual) return { start: now, snapped: false }
  const early = new Date(usual).getTime() - now.getTime()
  return early > 0 && early <= EARLY_GRACE_MIN * 60000 ? { start: new Date(usual), snapped: true } : { start: now, snapped: false }
}

// What a sign-out at `now` records:
// - before the usual finish: the real time
// - up to 20 minutes after it: the usual finish
// - later: the time rounded to the nearest 15 minutes, which the worker is asked to confirm
export function finishTimeFor(startIso: string, now: Date, dayEnd?: string | null) {
  const usual = usualFinish(startIso, dayEnd)
  const usualMs = usual ? new Date(usual).getTime() : NaN
  if (!usual || usualMs <= new Date(startIso).getTime() || now.getTime() <= usualMs) return { end: now, usual, late: false }
  if (now.getTime() - usualMs <= LATE_GRACE_MIN * 60000) return { end: new Date(usual), usual, late: false }
  return { end: roundToQuarter(now), usual, late: true }
}

export async function closeEntry(
  supabase: Supabase,
  entry: { id: string; start_time: string },
  now = new Date(),
  dayEnd?: string | null,
) {
  const start = new Date(entry.start_time)
  const hours = (now.getTime() - start.getTime()) / 3600000
  if (hours > MAX_SHIFT_HOURS) {
    // Forgotten sign-out: use the job's usual finish that day, or 8 hours if that doesn't fit
    const usual = usualFinish(entry.start_time, dayEnd)
    const end = usual && new Date(usual) > start ? new Date(usual) : new Date(start.getTime() + AUTO_CLOSE_HOURS * 3600000)
    await supabase
      .from('time_entries')
      .update({
        end_time: end.toISOString(),
        needs_review: true,
        review_reason: `Forgot to sign out. Finish set to ${fmtClock(end)} until the real time is given.`,
      })
      .eq('id', entry.id)
    return { hours: (end.getTime() - start.getTime()) / 3600000, flagged: true, end }
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

type OpenRow = {
  id: string; start_time: string; worker_id: string
  workers: { phone: string; active: boolean } | null
  jobs: { code: string; address: string | null; day_end: string | null } | null
}
const site = (e: OpenRow) => e.jobs?.address ?? e.jobs?.code ?? 'the job'

// 13 hours after sign-in: "Still signed in?"
export async function sendDueReminders(supabase: Supabase) {
  const cutoff = new Date(Date.now() - REMIND_AFTER_HOURS * 3600000).toISOString()
  const { data } = await supabase
    .from('time_entries')
    .select('id, start_time, worker_id, workers(phone, active), jobs(code, address, day_end)')
    .is('end_time', null)
    .is('reminded_at', null)
    .lte('start_time', cutoff)
  let sent = 0
  for (const e of (data ?? []) as unknown as OpenRow[]) {
    await supabase.from('time_entries').update({ reminded_at: new Date().toISOString() }).eq('id', e.id)
    if (!e.workers?.active) continue
    const since = (Date.now() - new Date(e.start_time).getTime()) / 3600000
    const ok = await sendButtons(
      waNumber(e.workers.phone),
      `You haven't signed out yet. You've been signed in at ${site(e)} since ${fmtClock(e.start_time)} (${fmtDuration(since)}). Are you still on the job?`,
      [
        { id: 'signout', title: 'Sign out now' },
        { id: 'still_working', title: 'Still working' },
        { id: 'finished_earlier', title: 'Fix finish time' },
      ],
    )
    if (ok) sent++
  }
  return sent
}

// 16 hours after sign-in with no sign-out: set the usual finish, flag it, and ask the worker for the real finish time.
export async function autoCloseStale(supabase: Supabase) {
  const cutoff = new Date(Date.now() - MAX_SHIFT_HOURS * 3600000).toISOString()
  const { data } = await supabase
    .from('time_entries')
    .select('id, start_time, worker_id, workers(phone, active), jobs(code, address, day_end)')
    .is('end_time', null)
    .lt('start_time', cutoff)
  for (const e of (data ?? []) as unknown as OpenRow[]) {
    const closed = await closeEntry(supabase, e, new Date(), e.jobs?.day_end)
    if (!e.workers?.active) continue
    await askForFinishTime(supabase, e.worker_id, e.id)
    await sendText(
      waNumber(e.workers.phone),
      `You didn't sign out at ${site(e)}, so I've put your finish time as ${fmtClock(closed.end)}. ` +
        `If you finished at a different time, reply with the time, e.g. 4:30pm.`,
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
