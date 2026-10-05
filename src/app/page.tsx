import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Job Tracker</h1>
        <p className="text-gray-400 mb-10">Know your profit on every job, automatically.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <StatCard label="Active Jobs" value="—" />
          <StatCard label="Labour This Week" value="—" />
          <StatCard label="Unmatched Expenses" value="—" />
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
      <p className="text-gray-400 text-sm mb-1">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  )
}
