import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase'
import { HEALTH_COLOR, HEALTH_LABEL, forecast, jobNumbers, type JobSummary } from '@/lib/forecast'
import { fmtDate, hrs, money, sydneyMidnightISO, todaySydney } from '@/lib/format'
import { BudgetBar, Empty, Stat } from '@/components/ui'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'active', label: 'Active jobs', statuses: ['active'] },
  { key: 'waiting', label: 'Waiting for decision', statuses: ['quoted'] },
  { key: 'finished', label: 'Finished jobs', statuses: ['complete', 'invoiced', 'paid'] },
  { key: 'missed', label: 'Missed projects', statuses: ['rejected'] },
] as const

function mondayThisWeek() {
  const today = todaySydney()
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

export default async function Home({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: tabParam } = await searchParams
  const tab = TABS.find((t) => t.key === tabParam) ?? TABS[0]
  const supabase = createServiceClient()

  const [{ data: jobsData }, { data: weekEntries }, { count: toCheck }, { count: hoursToCheck }] = await Promise.all([
    supabase.from('job_summary').select('*').order('created_at', { ascending: false }),
    supabase.from('time_entry_costs').select('paid_hours').gte('start_time', sydneyMidnightISO(mondayThisWeek())),
    supabase.from('expenses').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('time_entries').select('*', { count: 'exact', head: true }).eq('needs_review', true),
  ])

  const jobs = (jobsData ?? []) as JobSummary[]
  const counts = Object.fromEntries(TABS.map((t) => [t.key, jobs.filter((j) => (t.statuses as readonly string[]).includes(j.status)).length]))
  const shown = jobs.filter((j) => (tab.statuses as readonly string[]).includes(j.status))

  const weekHours = (weekEntries ?? []).reduce((sum, e) => sum + Number(e.paid_hours), 0)

  const activeHealth = jobs
    .filter((j) => j.status === 'active')
    .map((j) => forecast(j, jobNumbers(j)).health)
  const needsAttention = activeHealth.filter((h) => h === 'behind' || h === 'over').length

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Stat label="Active jobs" value={String(counts.active)} />
        <Stat label="Hours logged this week" value={weekHours > 0 ? hrs(weekHours) : '—'} />
        <Stat
          label="Jobs needing attention"
          value={String(needsAttention)}
          tone={needsAttention ? 'red' : undefined}
          sub={needsAttention ? 'over or using hours too fast' : 'all on track'}
        />
        <Link href="/hours">
          <Stat label="Hours to check" value={String(hoursToCheck ?? 0)} tone={hoursToCheck ? 'red' : undefined} sub="forgotten sign-outs" />
        </Link>
        <Link href="/inbox">
          <Stat label="Invoices to check" value={String(toCheck ?? 0)} tone={toCheck ? 'yellow' : undefined} sub="tap to review" />
        </Link>
      </div>

      <div className="flex gap-1 mb-5 overflow-x-auto whitespace-nowrap border-b border-gray-800">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === 'active' ? '/' : `/?tab=${t.key}`}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px ${
              t.key === tab.key ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            {t.label} <span className="text-gray-500">({counts[t.key]})</span>
          </Link>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty>
          {tab.key === 'waiting' || tab.key === 'active' ? (
            <>
              No jobs here yet.{' '}
              <Link href="/jobs/new" className="text-blue-400 hover:underline">Upload a quote</Link> to get started.
            </>
          ) : (
            'Nothing here yet.'
          )}
        </Empty>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {shown.map((j) => <JobTile key={j.id} job={j} />)}
        </div>
      )}
    </div>
  )
}

function JobTile({ job: j }: { job: JobSummary }) {
  const nums = jobNumbers(j)
  const f = j.status === 'active' ? forecast(j, nums) : null

  return (
    <Link href={`/jobs/${j.id}`} className="block bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-600 transition">
      <div className="flex items-center justify-between gap-2">
        <span className="text-blue-400 font-mono text-sm font-bold">{j.code}</span>
        {f && <span className={`text-xs px-2 py-0.5 rounded-full ${HEALTH_COLOR[f.health]}`}>{HEALTH_LABEL[f.health]}</span>}
      </div>
      <p className="font-semibold mt-1 truncate">{j.client_name ?? 'Unnamed job'}</p>
      <p className="text-gray-400 text-sm truncate">{j.address ?? '—'}</p>

      {j.status === 'active' && (
        <div className="mt-4 space-y-3">
          <BudgetBar label="Labour hours" used={nums.hoursUsed} budget={nums.hoursBudget} format={hrs} />
          <BudgetBar label="Materials" used={nums.materialsCost} budget={nums.materialsBudget} format={money} />
          <p className="text-xs text-gray-500">
            {fmtDate(j.start_date)} → {fmtDate(j.planned_finish)}
          </p>
        </div>
      )}

      {j.status === 'quoted' && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-gray-300">Quote {money(nums.income)}</span>
          <span className="text-purple-300">Accept or reject →</span>
        </div>
      )}

      {['complete', 'invoiced', 'paid'].includes(j.status) && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-gray-300">Profit {money(nums.profit)}</span>
          {nums.margin != null && (
            <span className={nums.margin >= 0.3 ? 'text-green-400' : nums.margin >= 0.15 ? 'text-yellow-400' : 'text-red-400'}>
              {Math.round(nums.margin * 100)}% margin
            </span>
          )}
        </div>
      )}

      {j.status === 'rejected' && (
        <p className="mt-4 text-sm text-gray-400 line-clamp-2">
          <span className="text-red-400">Why: </span>
          {j.rejection_reason ?? '—'}
        </p>
      )}
    </Link>
  )
}
