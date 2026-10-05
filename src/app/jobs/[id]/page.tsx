import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServiceClient()

  const { data: job } = await supabase
    .from('job_summary')
    .select('*')
    .eq('id', id)
    .single()

  if (!job) notFound()

  const labour = Number(job.labour_cost ?? 0)
  const materials = Number(job.materials_cost ?? 0)
  const subbies = Number(job.subbie_cost ?? 0)
  const variations = Number(job.variations_total ?? 0)
  const totalCost = labour + materials + subbies
  const income = Number(job.quote_total ?? 0) + variations
  const profit = income - totalCost
  const margin = income > 0 ? Math.round((profit / income) * 100) : null

  // Fetch recent time entries
  const { data: entries } = await supabase
    .from('time_entries')
    .select('id, start_time, end_time, workers(name)')
    .eq('job_id', id)
    .order('start_time', { ascending: false })
    .limit(10)

  // Fetch recent expenses
  const { data: expenses } = await supabase
    .from('expenses')
    .select('id, supplier, total, expense_date, status, category')
    .eq('job_id', id)
    .order('created_at', { ascending: false })
    .limit(10)

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link href="/jobs" className="text-gray-400 hover:text-white text-sm">← All Jobs</Link>
          <div className="flex items-start justify-between mt-3">
            <div>
              <div className="flex items-center gap-3">
                <span className="text-blue-400 font-mono font-bold text-lg">{job.code}</span>
                <StatusBadge status={job.status} />
              </div>
              <h1 className="text-2xl font-bold mt-1">{job.client_name ?? 'Unnamed Job'}</h1>
              {job.address && <p className="text-gray-400">{job.address}</p>}
            </div>
            {margin !== null && (
              <div className="text-right">
                <p className={`text-3xl font-bold ${margin >= 30 ? 'text-green-400' : margin >= 15 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {margin}%
                </p>
                <p className="text-gray-400 text-sm">margin</p>
              </div>
            )}
          </div>
        </div>

        {/* Profit Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <SummaryCard label="Quoted" value={income > 0 ? `$${Math.round(income).toLocaleString()}` : '—'} />
          <SummaryCard label="Labour" value={labour > 0 ? `$${Math.round(labour).toLocaleString()}` : '—'} sub={labour > 0 && job.quoted_hours ? `vs $${Math.round(Number(job.quoted_hours) * 65 * 1.4).toLocaleString()} budgeted` : undefined} />
          <SummaryCard label="Materials" value={materials > 0 ? `$${Math.round(materials).toLocaleString()}` : '—'} sub={materials > 0 && job.quoted_materials ? `vs $${Math.round(Number(job.quoted_materials)).toLocaleString()} budgeted` : undefined} />
          <SummaryCard
            label="Profit"
            value={income > 0 ? `$${Math.round(profit).toLocaleString()}` : '—'}
            highlight={profit > 0 ? 'green' : profit < 0 ? 'red' : undefined}
          />
        </div>

        {/* Time Entries */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Labour Log</h2>
          {!entries?.length ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-500 text-sm">
              No clock-ins yet. Workers WhatsApp &quot;on {job.code}&quot; to start.
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">Worker</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">Start</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">End</th>
                    <th className="text-right px-4 py-3 text-gray-400 font-medium">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const start = new Date(e.start_time)
                    const end = e.end_time ? new Date(e.end_time) : null
                    const hours = end ? ((end.getTime() - start.getTime()) / 3600000).toFixed(1) : null
                    return (
                      <tr key={e.id} className="border-b border-gray-800/50 last:border-0">
                        <td className="px-4 py-3">{(e.workers as unknown as { name: string } | null)?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-300">{fmt(start)}</td>
                        <td className="px-4 py-3 text-gray-300">{end ? fmt(end) : <span className="text-green-400">Active</span>}</td>
                        <td className="px-4 py-3 text-right font-mono">{hours ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Expenses */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Materials & Costs</h2>
          {!expenses?.length ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-500 text-sm">
              No expenses yet. Forward supplier receipts to add costs.
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">Supplier</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">Date</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">Type</th>
                    <th className="text-right px-4 py-3 text-gray-400 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((exp) => (
                    <tr key={exp.id} className="border-b border-gray-800/50 last:border-0">
                      <td className="px-4 py-3">{exp.supplier ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-300">{exp.expense_date ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-gray-800 px-2 py-0.5 rounded">{exp.category}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">${Number(exp.total).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function fmt(d: Date) {
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function SummaryCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: 'green' | 'red' }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      <p className={`text-xl font-bold ${highlight === 'green' ? 'text-green-400' : highlight === 'red' ? 'text-red-400' : ''}`}>{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-0.5">{sub}</p>}
    </div>
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
