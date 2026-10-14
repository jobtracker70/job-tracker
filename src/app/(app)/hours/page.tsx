import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase'
import { shiftsToCheck } from '@/lib/checks'
import { fmtClock, fmtDate, hrs, money, sydneyMidnightISO, toSydneyLocalInput, todaySydney } from '@/lib/format'
import { AlertBar, SmallTag, buttonClass, cardClass, dangerButtonClass, inputClass, secondaryButtonClass } from '@/components/ui'
import { addEntry, deleteEntry, markReviewed, updateEntry } from './actions'

export const dynamic = 'force-dynamic'

type Entry = {
  id: string; job_id: string; worker_id: string; worker_name: string; worker_type: string
  start_time: string; end_time: string | null; needs_review: boolean; review_reason: string | null
  work_day: string; is_weekend: boolean; raw_hours: number; paid_hours: number; overtime_hours: number; cost: number; has_rate: boolean
}
type Job = { id: string; code: string; client_name: string | null; address: string | null; status: string }

const jobName = (j: Job | undefined) => j?.address ?? j?.code ?? 'a job'

export default async function HoursPage({ searchParams }: { searchParams: Promise<{ job?: string; error?: string }> }) {
  const { job: jobFilter, error } = await searchParams
  const supabase = createServiceClient()
  const today = todaySydney()
  const twoWeeksAgo = new Date(`${today}T00:00:00Z`)
  twoWeeksAgo.setUTCDate(twoWeeksAgo.getUTCDate() - 14)

  let recentQuery = supabase.from('time_entry_costs').select('*').order('start_time', { ascending: false }).limit(300)
  recentQuery = jobFilter ? recentQuery.eq('job_id', jobFilter) : recentQuery.gte('start_time', sydneyMidnightISO(twoWeeksAgo.toISOString().slice(0, 10)))

  const [{ data: recentData }, toCheck, { data: todayData }, { data: workers }, { data: jobsData }] = await Promise.all([
    recentQuery,
    shiftsToCheck(supabase),
    supabase.from('time_entries').select('worker_id, end_time').gte('start_time', sydneyMidnightISO(today)),
    supabase.from('workers').select('id, name, type').eq('active', true).order('name'),
    supabase.from('jobs').select('id, code, client_name, address, status').in('status', ['active', 'complete', 'invoiced', 'paid']).order('created_at', { ascending: false }),
  ])
  const recent = (recentData ?? []) as Entry[]
  const jobs = (jobsData ?? []) as Job[]
  const jobById = new Map(jobs.map((j) => [j.id, j]))
  const checks = jobFilter ? toCheck.filter((c) => c.jobId === jobFilter) : toCheck

  const onSite = (todayData ?? []).filter((e) => !e.end_time).length
  const signedIn = new Set((todayData ?? []).map((e) => e.worker_id))
  const weekday = ![0, 6].includes(new Date(`${today}T00:00:00Z`).getUTCDay())
  const notSignedIn = weekday ? (workers ?? []).filter((w) => w.type !== 'subbie_fixed' && !signedIn.has(w.id)) : []
  const back = jobFilter ? `/hours?job=${jobFilter}` : '/hours'
  const filtered = jobFilter ? jobById.get(jobFilter) : undefined

  // Group recent shifts by day
  const days = new Map<string, Entry[]>()
  for (const e of recent) days.set(e.work_day, [...(days.get(e.work_day) ?? []), e])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[28px] md:text-[32px] font-bold leading-tight">Hours</h1>
          {filtered && (
            <p className="text-muted text-sm mt-1">
              {jobName(filtered)} only · <Link href="/hours" className="text-brand font-medium">show all</Link>
            </p>
          )}
        </div>
        <details className="group relative">
          <summary className={`${secondaryButtonClass} cursor-pointer`}>+ Add hours</summary>
          <form action={addEntry} className={`${cardClass} absolute right-0 z-10 mt-2 w-[min(92vw,380px)] p-4 space-y-3`}>
            <input type="hidden" name="back" value={back} />
            <Select label="Worker" name="worker_id" options={(workers ?? []).map((w) => [w.id, w.name])} />
            <Select label="Job" name="job_id" defaultValue={jobFilter} options={jobs.map((j) => [j.id, `${jobName(j)} (${j.code})`])} />
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="text-sm font-medium">Start</span>
                <input type="datetime-local" name="start" required defaultValue={`${today}T07:00`} className={`${inputClass} mt-1.5 !px-2`} /></label>
              <label className="block"><span className="text-sm font-medium">Finish</span>
                <input type="datetime-local" name="end" defaultValue={`${today}T15:30`} className={`${inputClass} mt-1.5 !px-2`} /></label>
            </div>
            <button className={`${buttonClass} w-full`}>Save hours</button>
          </form>
        </details>
      </div>

      {error && <AlertBar>{error}</AlertBar>}

      <div className="grid grid-cols-3 gap-3">
        <Tile value={String(onSite)} label="On site now" />
        <Tile
          value={String(notSignedIn.length)}
          extra={notSignedIn.length ? `(${notSignedIn.map((w) => w.name.split(' ')[0]).join(', ')})` : undefined}
          label={weekday ? 'Not signed in today' : 'Weekend'}
        />
        <Tile value={String(checks.length)} label="To check" tone={checks.length ? 'bad' : undefined} />
      </div>

      {checks.length > 0 && (
        <div className="bg-bad-tint border border-bad/20 rounded-2xl p-4 space-y-3">
          <p className="text-bad font-bold">⚠ Needs checking</p>
          {checks.map((c) => (
            <div key={c.id} className={`${cardClass} p-4`}>
              <p><strong>{c.workerName}</strong>, {c.jobLabel}, {c.reason}</p>
              <p className="text-faint text-sm mt-0.5">{fmtDate(c.start.slice(0, 10))} · {fmtClock(c.start)}–{c.end ? fmtClock(c.end) : 'now'}</p>
              <details className="group mt-3">
                <summary className="flex gap-2">
                  <form action={markReviewed.bind(null, c.id, back)}><button className={buttonClass}>Looks right</button></form>
                  <span className={`${secondaryButtonClass} cursor-pointer`}>Fix time</span>
                </summary>
                <form action={updateEntry.bind(null, c.id)} className="grid grid-cols-2 gap-2 items-end mt-3">
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="job_id" value={c.jobId} />
                  <label className="block"><span className="text-sm font-medium">Start</span>
                    <input type="datetime-local" name="start" required defaultValue={toSydneyLocalInput(c.start)} className={`${inputClass} mt-1.5 !px-2`} /></label>
                  <label className="block"><span className="text-sm font-medium">Finish</span>
                    <input type="datetime-local" name="end" defaultValue={toSydneyLocalInput(c.end)} className={`${inputClass} mt-1.5 !px-2`} /></label>
                  <button className={`${buttonClass} col-span-2`}>Save time</button>
                </form>
              </details>
            </div>
          ))}
        </div>
      )}

      <section>
        <h2 className="text-lg font-bold mb-3">{jobFilter ? 'All shifts on this job' : 'Recent shifts'}</h2>
        {!recent.length ? (
          <div className={`${cardClass} p-8 text-center text-muted`}>No shifts yet. Workers sign in on WhatsApp.</div>
        ) : (
          <div className="space-y-5">
            {[...days.entries()].map(([day, list]) => (
              <div key={day}>
                <p className="text-sm font-semibold text-muted mb-2">{new Date(`${day}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</p>
                <div className={cardClass}>
                  {list.map((e) => <ShiftRow key={e.id} e={e} jobs={jobs} job={jobById.get(e.job_id)} back={back} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Tile({ value, label, extra, tone }: { value: string; label: string; extra?: string; tone?: 'bad' }) {
  return (
    <div className={`${cardClass} p-4`}>
      <p className={`text-2xl font-bold ${tone === 'bad' ? 'text-bad' : ''}`}>{value} {extra && <span className="text-sm font-medium text-muted">{extra}</span>}</p>
      <p className="text-muted text-sm">{label}</p>
    </div>
  )
}

function Select({ label, name, options, defaultValue }: { label: string; name: string; options: [string, string][]; defaultValue?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <select name={name} required defaultValue={defaultValue ?? ''} className={`${inputClass} mt-1.5`}>
        <option value="" disabled>Choose…</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

function ShiftRow({ e, jobs, job, back }: { e: Entry; jobs: Job[]; job: Job | undefined; back: string }) {
  const byWorker = e.review_reason?.toLowerCase().includes('worker')
  return (
    <details id={`shift-${e.id}`} className="group border-b border-line last:border-0">
      <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-page/60">
        <span className="min-w-0">
          <span className="font-semibold">{e.worker_name}</span>
          <span className="text-muted"> · {job?.address ?? job?.code ?? '—'}</span>
          <span className="block text-sm text-muted">{fmtClock(e.start_time)} to {e.end_time ? fmtClock(e.end_time) : <span className="text-good font-medium">on site now</span>}</span>
          <span className="flex flex-wrap gap-1 mt-1">
            {e.needs_review && <SmallTag tone="bad">check</SmallTag>}
            {e.is_weekend && <SmallTag tone="brand">weekend</SmallTag>}
            {Number(e.overtime_hours) > 0.01 && <SmallTag tone="brand">{hrs(Number(e.overtime_hours))} overtime</SmallTag>}
            {!e.needs_review && byWorker && <SmallTag tone="warn">fixed by worker</SmallTag>}
          </span>
        </span>
        <span className="flex items-center gap-3 shrink-0">
          <span className="text-right">
            <span className="block font-bold">{hrs(Number(e.paid_hours))}</span>
            {Number(e.cost) > 0 && <span className="block text-sm text-faint">{money(Number(e.cost))}</span>}
          </span>
          <span className="text-faint transition group-open:rotate-90">›</span>
        </span>
      </summary>
      <div className="px-4 pb-4 space-y-3">
        {e.review_reason && <p className="text-sm text-muted">{e.review_reason}</p>}
        <form action={updateEntry.bind(null, e.id)} className="grid sm:grid-cols-3 gap-2 items-end">
          <input type="hidden" name="back" value={back} />
          <label className="block"><span className="text-sm font-medium">Job</span>
            <select name="job_id" defaultValue={e.job_id} className={`${inputClass} mt-1.5`}>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.address ?? j.code}</option>)}
            </select></label>
          <label className="block"><span className="text-sm font-medium">Start</span>
            <input type="datetime-local" name="start" required defaultValue={toSydneyLocalInput(e.start_time)} className={`${inputClass} mt-1.5 !px-2`} /></label>
          <label className="block"><span className="text-sm font-medium">Finish</span>
            <input type="datetime-local" name="end" defaultValue={toSydneyLocalInput(e.end_time)} className={`${inputClass} mt-1.5 !px-2`} /></label>
          <button className={`${buttonClass} sm:col-span-3`}>Save shift</button>
        </form>
        <form action={deleteEntry.bind(null, e.id, back)}><button className={dangerButtonClass}>Delete this shift</button></form>
      </div>
    </details>
  )
}
