import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase'
import { fmtClock, fmtDate, hrs, money, sydneyMidnightISO, toSydneyLocalInput, todaySydney } from '@/lib/format'
import { Card, Empty, SectionTitle, Stat, buttonClass, dangerButtonClass, inputClass, secondaryButtonClass } from '@/components/ui'
import { addEntry, deleteEntry, markReviewed, updateEntry } from './actions'

export const dynamic = 'force-dynamic'

type Entry = {
  id: string; job_id: string; worker_id: string; worker_name: string; worker_type: string
  start_time: string; end_time: string | null; needs_review: boolean; review_reason: string | null
  work_day: string; is_weekend: boolean; raw_hours: number; paid_hours: number; overtime_hours: number; cost: number; has_rate: boolean
}
type Job = { id: string; code: string; client_name: string | null; status: string }

export default async function HoursPage({ searchParams }: { searchParams: Promise<{ job?: string; error?: string }> }) {
  const { job: jobFilter, error } = await searchParams
  const supabase = createServiceClient()
  const today = todaySydney()
  const twoWeeksAgo = new Date(`${today}T00:00:00Z`)
  twoWeeksAgo.setUTCDate(twoWeeksAgo.getUTCDate() - 14)
  const since = sydneyMidnightISO(twoWeeksAgo.toISOString().slice(0, 10))

  let recentQuery = supabase.from('time_entry_costs').select('*').order('start_time', { ascending: false }).limit(300)
  recentQuery = jobFilter ? recentQuery.eq('job_id', jobFilter) : recentQuery.gte('start_time', since)

  const [{ data: recentData }, { data: reviewData }, { data: todayData }, { data: workers }, { data: jobsData }] = await Promise.all([
    recentQuery,
    supabase.from('time_entry_costs').select('*').eq('needs_review', true).order('start_time', { ascending: false }),
    supabase.from('time_entry_costs').select('*').gte('start_time', sydneyMidnightISO(today)).order('start_time'),
    supabase.from('workers').select('id, name, type').eq('active', true).order('name'),
    supabase.from('jobs').select('id, code, client_name, status').in('status', ['active', 'complete', 'invoiced', 'paid']).order('created_at', { ascending: false }),
  ])
  const recent = (recentData ?? []) as Entry[]
  const toReview = (reviewData ?? []) as Entry[]
  const todays = (todayData ?? []) as Entry[]
  const jobs = (jobsData ?? []) as Job[]
  const jobCode = new Map(jobs.map((j) => [j.id, j.code]))

  const onSite = todays.filter((e) => !e.end_time)
  const signedInToday = new Set(todays.map((e) => e.worker_id))
  const weekday = ![0, 6].includes(new Date(`${today}T00:00:00Z`).getUTCDay())
  const notSignedIn = (workers ?? []).filter((w) => w.type !== 'subbie_fixed' && !signedInToday.has(w.id))
  const back = jobFilter ? `/hours?job=${jobFilter}` : '/hours'
  const filteredJob = jobFilter ? jobs.find((j) => j.id === jobFilter) : null

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Hours</h1>
          <p className="text-gray-400 text-sm mt-1">
            Sign-ins from WhatsApp land here. Fix anything that looks wrong — labour cost updates straight away.
          </p>
        </div>
        {filteredJob && (
          <p className="text-sm">
            Showing <Link href={`/jobs/${filteredJob.id}`} className="text-blue-400 font-mono">{filteredJob.code}</Link> only ·{' '}
            <Link href="/hours" className="text-blue-400 hover:underline">show all</Link>
          </p>
        )}
      </div>

      {error && <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>}

      {/* Today */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="On site now" value={String(onSite.length)} sub={onSite.map((e) => `${e.worker_name.split(' ')[0]} @ ${jobCode.get(e.job_id) ?? '?'}`).join(', ') || undefined} />
        <Stat label="Signed in today" value={String(signedInToday.size)} />
        <Stat
          label="Not signed in today"
          value={String(weekday ? notSignedIn.length : 0)}
          sub={weekday ? notSignedIn.map((w) => w.name.split(' ')[0]).join(', ') || 'everyone is in' : 'weekend'}
          tone={weekday && notSignedIn.length ? 'yellow' : undefined}
        />
        <Stat label="Hours to check" value={String(toReview.length)} tone={toReview.length ? 'red' : undefined} sub="forgotten sign-outs" />
      </div>

      {/* Needs checking */}
      {toReview.length > 0 && (
        <section>
          <SectionTitle>Check these hours</SectionTitle>
          <div className="space-y-3">
            {toReview.map((e) => <EntryCard key={e.id} e={e} jobs={jobs} jobCode={jobCode} back={back} open />)}
          </div>
        </section>
      )}

      {/* Add */}
      <section>
        <SectionTitle>Add hours</SectionTitle>
        <Card>
          <form action={addEntry} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <input type="hidden" name="back" value={back} />
            <label className="text-sm">
              <span className="text-gray-300">Worker</span>
              <select name="worker_id" required defaultValue="" className={`${inputClass} mt-1`}>
                <option value="" disabled>Choose…</option>
                {(workers ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-gray-300">Job</span>
              <select name="job_id" required defaultValue={jobFilter ?? ''} className={`${inputClass} mt-1`}>
                <option value="" disabled>Choose…</option>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.client_name ?? 'Unnamed'}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-gray-300">Start</span>
              <input type="datetime-local" name="start" required defaultValue={`${today}T07:00`} className={`${inputClass} mt-1`} />
            </label>
            <label className="text-sm">
              <span className="text-gray-300">Finish</span>
              <input type="datetime-local" name="end" defaultValue={`${today}T15:30`} className={`${inputClass} mt-1`} />
            </label>
            <button className={buttonClass}>Add hours</button>
          </form>
          <p className="text-xs text-gray-500 mt-2">Times are Sydney time. Unpaid breaks and weekend/overtime rates are applied automatically.</p>
        </Card>
      </section>

      {/* Recent */}
      <section>
        <SectionTitle>{jobFilter ? 'All hours on this job' : 'Last 14 days'}</SectionTitle>
        {!recent.length ? (
          <Empty>No hours yet.</Empty>
        ) : (
          <div className="space-y-2">
            {recent.map((e) => <EntryCard key={e.id} e={e} jobs={jobs} jobCode={jobCode} back={back} />)}
          </div>
        )}
      </section>
    </div>
  )
}

function EntryCard({ e, jobs, jobCode, back, open = false }: { e: Entry; jobs: Job[]; jobCode: Map<string, string>; back: string; open?: boolean }) {
  const byWorker = e.review_reason?.toLowerCase().includes('worker')
  const byOwner = e.review_reason?.toLowerCase().includes('owner')
  const paid = Number(e.paid_hours)
  const raw = Number(e.raw_hours)
  return (
    <details open={open} className={`bg-gray-900 border rounded-xl ${e.needs_review ? 'border-red-800' : 'border-gray-800'}`}>
      <summary className="px-4 py-3 cursor-pointer flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-medium min-w-32">{e.worker_name}</span>
        <Link href={`/jobs/${e.job_id}`} className="text-blue-400 font-mono">{jobCode.get(e.job_id) ?? '—'}</Link>
        <span className="text-gray-300">{fmtDate(e.work_day)}</span>
        <span className="text-gray-400">
          {fmtClock(e.start_time)} – {e.end_time ? fmtClock(e.end_time) : <span className="text-green-400">on site now</span>}
        </span>
        <span className="font-mono">{hrs(paid)}{paid < raw - 0.01 && <span className="text-gray-500"> paid ({hrs(raw)} on site)</span>}</span>
        {Number(e.cost) > 0 && <span className="text-gray-400">{money(Number(e.cost))}</span>}
        {e.worker_type !== 'subbie' && e.worker_type !== 'subbie_fixed' && !e.has_rate && <span className="text-xs text-yellow-400">no rate</span>}
        {e.is_weekend && <span className="text-xs bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded-full">weekend</span>}
        {Number(e.overtime_hours) > 0.01 && <span className="text-xs bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded-full">{hrs(Number(e.overtime_hours))} overtime</span>}
        {e.needs_review && <span className="text-xs bg-red-900/50 text-red-300 px-2 py-0.5 rounded-full">check</span>}
        {!e.needs_review && byWorker && <span className="text-xs bg-yellow-900/50 text-yellow-300 px-2 py-0.5 rounded-full">fixed by worker</span>}
        {!e.needs_review && byOwner && <span className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded-full">edited</span>}
      </summary>
      <div className="px-4 pb-4 space-y-3">
        {e.review_reason && <p className="text-sm text-gray-400">{e.review_reason}</p>}
        <form action={updateEntry.bind(null, e.id)} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <input type="hidden" name="back" value={back} />
          <label className="text-sm">
            <span className="text-gray-300">Job</span>
            <select name="job_id" defaultValue={e.job_id} className={`${inputClass} mt-1`}>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.code}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-gray-300">Start</span>
            <input type="datetime-local" name="start" required defaultValue={toSydneyLocalInput(e.start_time)} className={`${inputClass} mt-1`} />
          </label>
          <label className="text-sm">
            <span className="text-gray-300">Finish <span className="text-gray-500">(blank = still on site)</span></span>
            <input type="datetime-local" name="end" defaultValue={toSydneyLocalInput(e.end_time)} className={`${inputClass} mt-1`} />
          </label>
          <button className={secondaryButtonClass}>Save changes</button>
        </form>
        <div className="flex gap-2">
          {e.needs_review && (
            <form action={markReviewed.bind(null, e.id, back)}><button className={buttonClass}>Looks right</button></form>
          )}
          <form action={deleteEntry.bind(null, e.id, back)}><button className={dangerButtonClass}>Delete these hours</button></form>
        </div>
      </div>
    </details>
  )
}
