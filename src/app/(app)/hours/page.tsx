import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase'
import { shiftsToCheck } from '@/lib/checks'
import { fmtClock, fmtDate, fmtDuration, hrs, money, sydneyMidnightISO, timeToMinutes, toSydneyLocalInput, todaySydney } from '@/lib/format'
import { DEFAULT_END, DEFAULT_START } from '@/lib/hours'
import { waNumber } from '@/lib/whatsapp'
import { AlertBar, SmallTag, buttonClass, cardClass, dangerButtonClass, inputClass, secondaryButtonClass } from '@/components/ui'
import { ShiftTimes } from '@/components/shift-times'
import { addEntry, deleteEntry, markReviewed, updateEntry } from './actions'

export const dynamic = 'force-dynamic'

type Entry = {
  id: string; job_id: string; worker_id: string; worker_name: string; worker_type: string
  start_time: string; end_time: string | null; needs_review: boolean; review_reason: string | null
  work_day: string; is_weekend: boolean; raw_hours: number; paid_hours: number; overtime_hours: number; cost: number; has_rate: boolean
}
type Job = { id: string; code: string; client_name: string | null; address: string | null; status: string; day_start: string | null; day_end: string | null }
type OnSite = { id: string; start_time: string; workers: { name: string } | null; jobs: { code: string; address: string | null } | null }

const usual = (j: Job | undefined) => ({ usualStart: timeToMinutes(j?.day_start, DEFAULT_START), usualEnd: timeToMinutes(j?.day_end, DEFAULT_END) })

const jobName = (j: Job | undefined) => j?.address ?? j?.code ?? 'a job'

export default async function HoursPage({ searchParams }: { searchParams: Promise<{ job?: string; error?: string; add?: string }> }) {
  const { job: jobFilter, error, add } = await searchParams
  const supabase = createServiceClient()
  const today = todaySydney()
  const twoWeeksAgo = new Date(`${today}T00:00:00Z`)
  twoWeeksAgo.setUTCDate(twoWeeksAgo.getUTCDate() - 14)

  let recentQuery = supabase.from('time_entry_costs').select('*').order('start_time', { ascending: false }).limit(300)
  recentQuery = jobFilter ? recentQuery.eq('job_id', jobFilter) : recentQuery.gte('start_time', sydneyMidnightISO(twoWeeksAgo.toISOString().slice(0, 10)))

  const [{ data: recentData }, toCheck, { data: todayData }, { data: openData }, { data: workers }, { data: jobsData }] = await Promise.all([
    recentQuery,
    shiftsToCheck(supabase),
    supabase.from('time_entries').select('worker_id').gte('start_time', sydneyMidnightISO(today)),
    supabase.from('time_entries').select('id, start_time, workers(name), jobs(code, address)').is('end_time', null).order('start_time'),
    supabase.from('workers').select('id, name, type, phone').eq('active', true).order('name'),
    supabase.from('jobs').select('id, code, client_name, address, status, day_start, day_end').in('status', ['active', 'complete', 'invoiced', 'paid']).order('created_at', { ascending: false }),
  ])
  const recent = (recentData ?? []) as Entry[]
  const jobs = (jobsData ?? []) as Job[]
  const jobById = new Map(jobs.map((j) => [j.id, j]))
  const checks = jobFilter ? toCheck.filter((c) => c.jobId === jobFilter) : toCheck

  const onSite = (openData ?? []) as unknown as OnSite[]
  const signedIn = new Set((todayData ?? []).map((e) => e.worker_id))
  const weekday = ![0, 6].includes(new Date(`${today}T00:00:00Z`).getUTCDay())
  const notSignedIn = weekday ? (workers ?? []).filter((w) => w.type !== 'subbie_fixed' && !signedIn.has(w.id)) : []
  const back = jobFilter ? `/hours?job=${jobFilter}` : '/hours'
  const filtered = jobFilter ? jobById.get(jobFilter) : undefined
  const activeJobs = jobs.filter((j) => j.status === 'active')
  const nowMs = new Date().getTime()

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
        <details id="add" className="group relative" open={!!add}>
          <summary className={`${secondaryButtonClass} cursor-pointer`}>+ Add hours</summary>
          <form action={addEntry} className={`${cardClass} absolute right-0 z-10 mt-2 w-[min(92vw,400px)] p-4 space-y-3`}>
            <input type="hidden" name="back" value={back} />
            <Select label="Worker" name="worker_id" defaultValue={add} options={(workers ?? []).map((w) => [w.id, w.name])} />
            <Select label="Job" name="job_id" defaultValue={jobFilter ?? (activeJobs.length === 1 ? activeJobs[0].id : undefined)} options={jobs.map((j) => [j.id, jobName(j)])} />
            <ShiftTimes defaultStart="" defaultEnd="" today={today} {...usual(filtered)} />
            <button className={`${buttonClass} w-full`}>Save hours</button>
          </form>
        </details>
      </div>

      {error && <AlertBar>{error}</AlertBar>}

      <div className="grid md:grid-cols-2 gap-4">
        <div className={`${cardClass} p-4`}>
          <p className="font-bold flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${onSite.length ? 'bg-good' : 'bg-line'}`} />
            On site now <span className="text-muted font-normal">({onSite.length})</span>
          </p>
          {!onSite.length ? (
            <p className="text-sm text-muted mt-2">Nobody is signed in right now.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {onSite.map((e) => (
                <li key={e.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-semibold">{e.workers?.name ?? 'Someone'}</span>
                    <span className="block text-muted truncate">{e.jobs?.address ?? e.jobs?.code ?? 'a job'}</span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block font-semibold">since {fmtClock(e.start_time)}</span>
                    <span className="block text-faint">{fmtDuration((nowMs - new Date(e.start_time).getTime()) / 3600000)} so far</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={`${cardClass} p-4`}>
          <p className="font-bold">
            {weekday ? 'Not signed in today' : 'Weekend'} {weekday && <span className="text-muted font-normal">({notSignedIn.length})</span>}
          </p>
          {!weekday ? (
            <p className="text-sm text-muted mt-2">No sign-ins expected today.</p>
          ) : !notSignedIn.length ? (
            <p className="text-sm text-good font-medium mt-2">Everyone has signed in ✓</p>
          ) : (
            <>
              <ul className="mt-2 divide-y divide-line">
                {notSignedIn.map((w) => (
                  <li key={w.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold">{w.name}</span>
                    <span className="flex gap-2 shrink-0">
                      <a href={`https://wa.me/${waNumber(w.phone)}`} target="_blank" className="text-brand font-semibold px-2 py-1 rounded-lg hover:bg-brand-tint">Message</a>
                      <Link href={`/hours?add=${w.id}#add`} className="text-brand font-semibold px-2 py-1 rounded-lg hover:bg-brand-tint">Add hours</Link>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-faint mt-2">Day off or forgot? Message them, or add their hours yourself.</p>
            </>
          )}
        </div>
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
                <form action={updateEntry.bind(null, c.id)} className="mt-4 pt-4 border-t border-line space-y-3">
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="job_id" value={c.jobId} />
                  <ShiftTimes defaultStart={toSydneyLocalInput(c.start)} defaultEnd={toSydneyLocalInput(c.end)} today={today} allowOpen={!c.end} {...usual(jobById.get(c.jobId))} />
                  <button className={`${buttonClass} w-full`}>Save time</button>
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
                  {list.map((e) => <ShiftRow key={e.id} e={e} jobs={jobs} job={jobById.get(e.job_id)} back={back} today={today} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
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

function ShiftRow({ e, jobs, job, back, today }: { e: Entry; jobs: Job[]; job: Job | undefined; back: string; today: string }) {
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
        <form action={updateEntry.bind(null, e.id)} className="space-y-3 max-w-md">
          <input type="hidden" name="back" value={back} />
          <label className="block"><span className="text-sm font-medium">Job</span>
            <select name="job_id" defaultValue={e.job_id} className={`${inputClass} mt-1.5`}>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.address ?? j.code}</option>)}
            </select></label>
          <ShiftTimes defaultStart={toSydneyLocalInput(e.start_time)} defaultEnd={toSydneyLocalInput(e.end_time)} today={today} allowOpen={!e.end_time} {...usual(job)} />
          <button className={`${buttonClass} w-full`}>Save shift</button>
        </form>
        <form action={deleteEntry.bind(null, e.id, back)}><button className={dangerButtonClass}>Delete this shift</button></form>
      </div>
    </details>
  )
}
