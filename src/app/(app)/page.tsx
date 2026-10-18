import Link from 'next/link'
import { getDb } from '@/lib/db'
import { forecast, jobNumbers, type JobSummary } from '@/lib/forecast'
import { invoicesToCheckCount, shiftsToCheck } from '@/lib/checks'
import { FINISHED, jobPill, jobSubtitle, jobTitle } from '@/lib/status'
import { fmtClock, hrs, money } from '@/lib/format'
import { Pill, ProgressBar, buttonClass, cardClass } from '@/components/ui'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'active', label: 'Active', match: (s: string) => s === 'active' },
  { key: 'quotes', label: 'Quotes', match: (s: string) => s === 'quoted' },
  { key: 'finished', label: 'Finished', match: (s: string) => FINISHED.includes(s) || s === 'rejected' },
] as const

export default async function Home({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: tabParam } = await searchParams
  const tab = TABS.find((t) => t.key === (tabParam === 'waiting' ? 'quotes' : tabParam)) ?? TABS[0]
  const { db } = await getDb()
  const tenHoursAgo = new Date(new Date().getTime() - 10 * 3600000).toISOString()

  const [{ data: jobsData }, shifts, invoiceCount, { data: longShifts }] = await Promise.all([
    db.from('job_summary').select('*').order('created_at', { ascending: false }),
    shiftsToCheck(db),
    invoicesToCheckCount(db),
    db
      .from('time_entries')
      .select('id, start_time, workers(name), jobs(address, code)')
      .is('end_time', null)
      .lt('start_time', tenHoursAgo),
  ])

  const jobs = ((jobsData ?? []) as JobSummary[]).map((j) => {
    const nums = jobNumbers(j)
    return { j, nums, f: forecast(j, nums) }
  })

  // Everything that needs the owner, in one place
  const attention: { text: string; href: string }[] = []
  if (invoiceCount) attention.push({ text: `${invoiceCount} invoice${invoiceCount > 1 ? 's' : ''} to check`, href: '/inbox' })
  if (shifts.length) attention.push({ text: `${shifts.length} shift${shifts.length > 1 ? 's' : ''} to check`, href: '/hours' })
  for (const { j } of jobs.filter((x) => x.j.status === 'active' && x.f.health === 'over')) {
    attention.push({ text: `${jobTitle(j)} is over budget`, href: `/jobs/${j.id}` })
  }
  for (const s of (longShifts ?? []) as unknown as { start_time: string; workers: { name: string } | null; jobs: { address: string | null; code: string } | null }[]) {
    attention.push({
      text: `${s.workers?.name.split(' ')[0] ?? 'Someone'} is still signed in at ${s.jobs?.address ?? s.jobs?.code ?? 'a job'} since ${fmtClock(s.start_time)}`,
      href: '/hours',
    })
  }

  const counts = Object.fromEntries(TABS.map((t) => [t.key, jobs.filter((x) => t.match(x.j.status)).length]))
  const shown = jobs.filter((x) => tab.match(x.j.status))

  return (
    <div className="space-y-6">
      {attention.length ? (
        <details className="group bg-warn-tint border border-warn/20 rounded-2xl">
          <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer text-warn font-semibold">
            <span>ⓘ {attention.length} thing{attention.length > 1 ? 's' : ''} need{attention.length > 1 ? '' : 's'} your attention</span>
            <span className="transition group-open:rotate-180">⌄</span>
          </summary>
          <ul className="px-4 pb-3 space-y-1">
            {attention.map((a, i) => (
              <li key={i}>
                <Link href={a.href} className="flex justify-between gap-3 py-1.5 text-ink hover:text-brand">
                  <span>{a.text}</span>
                  <span className="text-brand">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <div className="bg-good-tint border border-good/20 rounded-2xl px-4 py-3 text-good font-semibold">All good ✓</div>
      )}

      <h1 className="text-[28px] md:text-[32px] font-bold leading-tight">Jobs</h1>

      <div className={`${cardClass} inline-flex p-1 gap-1`}>
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === 'active' ? '/' : `/?tab=${t.key}`}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
              t.key === tab.key ? 'bg-brand-tint text-brand' : 'text-muted hover:text-ink'
            }`}
          >
            {t.label} <span className="font-normal">({counts[t.key]})</span>
          </Link>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className={`${cardClass} p-10 text-center`}>
          <p className="text-4xl mb-3">🖌️</p>
          <p className="font-semibold">{tab.key === 'finished' ? 'No finished jobs yet.' : tab.key === 'quotes' ? 'No quotes waiting.' : 'No active jobs yet.'}</p>
          {tab.key !== 'finished' && (
            <>
              <p className="text-muted text-sm mt-1">Add your first quote to get started.</p>
              <Link href="/jobs/new" className={`${buttonClass} mt-5`}>+ New quote</Link>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {shown.map(({ j, nums, f }) => {
            const pill = jobPill(j, f)
            return (
              <Link key={j.id} href={`/jobs/${j.id}`} className={`${cardClass} block p-5 hover:border-brand/40 transition`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-bold truncate">{jobTitle(j)}</p>
                    <p className="text-muted text-sm truncate">{jobSubtitle(j)}</p>
                  </div>
                  <Pill tone={pill.tone}>{pill.label}</Pill>
                </div>

                {j.status === 'active' && (
                  <div className="mt-5 space-y-4">
                    <ProgressBar label="Hours" used={nums.hoursUsed} budget={nums.hoursBudget} format={hrs} />
                    <ProgressBar label="Materials" used={nums.materialsCost} budget={nums.materialsBudget} format={money} />
                  </div>
                )}

                {j.status === 'quoted' && (
                  <div className="mt-5 flex items-center justify-between">
                    <span className="text-xl font-bold">{money(nums.income)}</span>
                    <span className="text-brand font-semibold text-sm">Accept or reject →</span>
                  </div>
                )}

                {FINISHED.includes(j.status) && (
                  <div className="mt-5 flex items-center justify-between">
                    <span><span className="text-muted text-sm">Profit </span><span className="text-xl font-bold">{money(nums.profit)}</span></span>
                    {nums.margin != null && (
                      <Pill tone={nums.margin >= 0.3 ? 'good' : nums.margin >= 0.15 ? 'warn' : 'bad'}>{Math.round(nums.margin * 100)}%</Pill>
                    )}
                  </div>
                )}

                {j.status === 'rejected' && <p className="mt-4 text-sm text-muted line-clamp-2">Why: {j.rejection_reason ?? '—'}</p>}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
