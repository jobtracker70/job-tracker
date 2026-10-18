import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '@/lib/db'
import { isSubbieType, loadJob, peopleOnJob, weekLabel, weekOf } from '@/lib/job-data'
import { jobTitle } from '@/lib/status'
import { fmtClock, fmtDate, hrs, money } from '@/lib/format'
import { SmallTag, cardClass } from '@/components/ui'

export const dynamic = 'force-dynamic'

const dayName = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

export default async function PersonOnJobPage({ params }: { params: Promise<{ id: string; workerId: string }> }) {
  const { id, workerId } = await params
  const { db } = await getDb()
  const data = await loadJob(db, id)
  if (!data) notFound()
  const { j, entries } = data
  const mine = entries.filter((e) => e.worker_id === workerId)
  const p = peopleOnJob(mine)[0]
  if (!p) notFound()
  const subbie = isSubbieType(p.type)
  const crewHours = entries.reduce((s, e) => s + Number(e.paid_hours), 0)

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link href={`/jobs/${id}`} className="text-brand text-sm font-medium hover:underline">← {jobTitle(j)}</Link>
        <h1 className="text-[26px] md:text-[32px] font-bold leading-tight mt-1">{p.name}</h1>
        <p className="text-muted">
          On {jobTitle(j)} · {fmtDate(p.firstDay)}{p.lastDay !== p.firstDay ? ` to ${fmtDate(p.lastDay)}` : ''}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Paid hours" value={hrs(p.hours)} />
        <Tile label="Days on site" value={String(p.days)} />
        <Tile label={subbie ? 'Cost' : 'Labour cost'} value={subbie ? 'invoice' : money(p.cost)} />
        <Tile label="Share of crew hours" value={crewHours ? `${Math.round((p.hours / crewHours) * 100)}%` : '—'} />
      </div>

      <section>
        <h2 className="text-lg font-bold mb-3">Week by week</h2>
        <div className="space-y-3">
          {p.weeks.map((w) => {
            const shifts = mine.filter((e) => weekOf(e.work_day) === w.week).sort((a, b) => a.start_time.localeCompare(b.start_time))
            return (
              <details key={w.week} open={p.weeks.length <= 2} className={`${cardClass} group`}>
                <summary className="flex items-center justify-between gap-3 px-4 py-3.5 cursor-pointer">
                  <span>
                    <span className="block font-bold">Week of {weekLabel(w.week)}</span>
                    <span className="block text-sm text-muted">{w.days} day{w.days === 1 ? '' : 's'} · {w.shifts} shift{w.shifts === 1 ? '' : 's'}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-right">
                      <span className="block font-bold text-lg">{hrs(w.hours)}</span>
                      {!subbie && <span className="block text-sm text-faint">{money(w.cost)}</span>}
                    </span>
                    <span className="text-faint text-xl transition group-open:rotate-90">›</span>
                  </span>
                </summary>
                <ul className="mx-3 mb-3 rounded-xl bg-page/70 border border-line divide-y divide-line">
                  {shifts.map((e) => (
                    <li key={e.id} className="px-3 py-2.5 flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0">
                        <span className="font-semibold">{dayName(e.work_day)}</span>
                        <span className="text-muted"> · {fmtClock(e.start_time)} to {e.end_time ? fmtClock(e.end_time) : 'now'}</span>
                        <span className="flex flex-wrap gap-1 mt-1">
                          {e.needs_review && <SmallTag tone="bad">check</SmallTag>}
                          {e.is_weekend && <SmallTag tone="brand">weekend</SmallTag>}
                          {Number(e.overtime_hours) > 0.01 && <SmallTag tone="brand">{hrs(Number(e.overtime_hours))} overtime</SmallTag>}
                        </span>
                      </span>
                      <span className="text-right shrink-0">
                        <span className="block font-semibold">{hrs(Number(e.paid_hours))}</span>
                        {!subbie && <span className="block text-faint">{money(Number(e.cost))}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )
          })}
        </div>
        <p className="text-xs text-faint mt-3">Paid hours have unpaid breaks taken off. Weeks run Monday to Sunday.</p>
      </section>

      <Link href={`/hours?job=${id}`} className="inline-block text-brand text-sm font-semibold">Fix or add hours on this job →</Link>
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${cardClass} p-4`}>
      <p className="text-xl font-bold">{value}</p>
      <p className="text-muted text-sm">{label}</p>
    </div>
  )
}
