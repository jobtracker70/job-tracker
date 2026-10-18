import type { BusinessDb } from './db'
import { fmtClock } from './format'

type Supabase = BusinessDb

export type ShiftToCheck = {
  id: string
  workerName: string
  jobId: string
  jobLabel: string
  start: string
  end: string | null
  reason: string
}

// Sign-ins before 6am or sign-outs after 7pm (Sydney) are unusual for painting and worth a glance.
const EARLY_HOUR = 6
const LATE_HOUR = 19

const sydneyHour = (ts: string) =>
  Number(new Intl.DateTimeFormat('en-AU', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Australia/Sydney' }).format(new Date(ts)))

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1)

type Row = {
  id: string; start_time: string; end_time: string | null; needs_review: boolean; review_reason: string | null; edited_by: string | null
  workers: { name: string } | null; jobs: { id: string; code: string; address: string | null } | null
}

export async function shiftsToCheck(supabase: Supabase): Promise<ShiftToCheck[]> {
  const since = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data } = await supabase
    .from('time_entries')
    .select('id, start_time, end_time, needs_review, review_reason, edited_by, workers(name), jobs(id, code, address)')
    .or(`needs_review.eq.true,start_time.gte."${since}"`)
    .order('start_time', { ascending: false })
  const out: ShiftToCheck[] = []
  for (const r of (data ?? []) as unknown as Row[]) {
    const name = r.workers?.name.split(' ')[0] ?? 'Someone'
    const base = {
      id: r.id, workerName: name, jobId: r.jobs?.id ?? '', jobLabel: r.jobs?.address ?? r.jobs?.code ?? 'a job', start: r.start_time, end: r.end_time,
    }
    if (r.needs_review) {
      out.push({ ...base, reason: r.review_reason?.startsWith('Forgot') ? `forgot to sign out. Set to ${r.end_time ? fmtClock(r.end_time) : '8h'}.` : lowerFirst(r.review_reason ?? 'needs checking.') })
      continue
    }
    if (r.edited_by) continue // already checked or changed by the owner
    if (sydneyHour(r.start_time) < EARLY_HOUR) {
      out.push({ ...base, reason: `signed in at ${fmtClock(r.start_time)}, earlier than usual. Is that right?` })
    } else if (r.end_time && sydneyHour(r.end_time) >= LATE_HOUR) {
      out.push({ ...base, reason: `signed out at ${fmtClock(r.end_time)}, later than usual. Is that right?` })
    }
  }
  return out
}

export async function invoicesToCheckCount(supabase: Supabase) {
  const { count } = await supabase.from('expenses').select('*', { count: 'exact', head: true }).eq('status', 'pending')
  return count ?? 0
}
