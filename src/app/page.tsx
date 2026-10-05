import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const supabase = createServiceClient()

  const { data: jobs } = await supabase
    .from('job_summary')
    .select('labour_cost, status')

  const activeJobs = jobs?.filter((j) => j.status === 'active').length ?? 0

  // Labour this week
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  weekStart.setHours(0, 0, 0, 0)
  const { data: weekEntries } = await supabase
    .from('time_entries')
    .select('start_time, end_time')
    .gte('start_time', weekStart.toISOString())

  const labourHours = weekEntries?.reduce((sum, e) => {
    const start = new Date(e.start_time)
    const end = e.end_time ? new Date(e.end_time) : new Date()
    return sum + (end.getTime() - start.getTime()) / 3600000
  }, 0) ?? 0

  const { count: unmatchedCount } = await supabase
    .from('expenses')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-1">Job Tracker</h1>
        <p className="text-gray-400 mb-10">Know your profit on every job, automatically.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <StatCard label="Active Jobs" value={String(activeJobs)} />
          <StatCard label="Labour This Week" value={labourHours > 0 ? `${labourHours.toFixed(0)}h` : '—'} />
          <StatCard
            label="Unmatched Expenses"
            value={unmatchedCount ? String(unmatchedCount) : '0'}
            highlight={!!unmatchedCount}
          />
        </div>

        <div className="flex gap-4">
          <Link
            href="/jobs"
            className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-medium transition"
          >
            View All Jobs
          </Link>
          <Link
            href="/jobs/new"
            className="bg-gray-800 hover:bg-gray-700 px-6 py-3 rounded-lg font-medium transition"
          >
            + New Job
          </Link>
        </div>
      </div>
    </main>
  )
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
      <p className="text-gray-400 text-sm mb-1">{label}</p>
      <p className={`text-2xl font-bold ${highlight ? 'text-yellow-400' : ''}`}>{value}</p>
    </div>
  )
}
