import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export default async function JobsPage() {
  const supabase = createServiceClient()
  const { data: jobs } = await supabase
    .from('job_summary')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/" className="text-gray-400 hover:text-white text-sm">← Dashboard</Link>
            <h1 className="text-2xl font-bold mt-2">All Jobs</h1>
          </div>
          <Link
            href="/jobs/new"
            className="bg-blue-600 hover:bg-blue-700 px-5 py-2.5 rounded-lg font-medium transition text-sm"
          >
            + New Job
          </Link>
        </div>

        {!jobs?.length ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-5xl mb-4">🏗️</p>
            <p className="text-lg font-medium text-gray-400">No jobs yet</p>
            <p className="text-sm mt-1">Upload a quote PDF to create your first job.</p>
            <Link href="/jobs/new" className="inline-block mt-6 bg-blue-600 hover:bg-blue-700 px-6 py-2.5 rounded-lg font-medium transition">
              Create First Job
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => {
              const totalCost = Number(job.labour_cost) + Number(job.materials_cost) + Number(job.subbie_cost)
              const income = Number(job.quote_total ?? 0) + Number(job.variations_total ?? 0)
              const profit = income - totalCost
              const margin = income > 0 ? Math.round((profit / income) * 100) : null

              return (
                <Link key={job.id} href={`/jobs/${job.id}`}>
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-600 transition cursor-pointer">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-3">
                          <span className="text-blue-400 font-mono text-sm font-bold">{job.code}</span>
                          <StatusBadge status={job.status} />
                        </div>
                        <p className="font-semibold mt-1">{job.client_name ?? 'Unnamed job'}</p>
                        {job.address && <p className="text-gray-400 text-sm">{job.address}</p>}
                      </div>
                      <div className="text-right">
                        {income > 0 && (
                          <p className="text-sm text-gray-400">Quote ${Math.round(income).toLocaleString()}</p>
                        )}
                        {totalCost > 0 && margin !== null && (
                          <p className={`font-bold text-lg ${margin >= 30 ? 'text-green-400' : margin >= 15 ? 'text-yellow-400' : 'text-red-400'}`}>
                            {margin}% margin
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-blue-900/50 text-blue-400',
    complete: 'bg-gray-800 text-gray-300',
    invoiced: 'bg-yellow-900/50 text-yellow-400',
    paid: 'bg-green-900/50 text-green-400',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] ?? 'bg-gray-800 text-gray-400'}`}>
      {status}
    </span>
  )
}
