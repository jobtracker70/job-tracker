export const inputClass =
  'w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500'

export const buttonClass =
  'bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-2 rounded-lg font-medium text-sm transition'

export const secondaryButtonClass =
  'bg-gray-800 hover:bg-gray-700 disabled:opacity-50 px-4 py-2 rounded-lg font-medium text-sm transition'

export const dangerButtonClass =
  'bg-red-900/60 hover:bg-red-800 text-red-200 disabled:opacity-50 px-4 py-2 rounded-lg font-medium text-sm transition'

const STATUS: Record<string, { label: string; cls: string }> = {
  quoted: { label: 'Waiting for decision', cls: 'bg-purple-900/50 text-purple-300' },
  active: { label: 'Active', cls: 'bg-blue-900/50 text-blue-400' },
  complete: { label: 'Finished', cls: 'bg-gray-800 text-gray-300' },
  invoiced: { label: 'Invoiced', cls: 'bg-yellow-900/50 text-yellow-400' },
  paid: { label: 'Paid', cls: 'bg-green-900/50 text-green-400' },
  rejected: { label: 'Missed', cls: 'bg-red-900/50 text-red-400' },
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: 'bg-gray-800 text-gray-400' }
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-gray-900 border border-gray-800 rounded-xl p-5 ${className}`}>{children}</div>
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'green' | 'red' | 'yellow' }) {
  const color = tone === 'green' ? 'text-green-400' : tone === 'red' ? 'text-red-400' : tone === 'yellow' ? 'text-yellow-400' : ''
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-0.5">{sub}</p>}
    </div>
  )
}

export function BudgetBar({
  label, used, budget, format,
}: { label: string; used: number; budget: number | null; format: (n: number) => string }) {
  const pct = budget ? Math.min(used / budget, 1) : 0
  const over = budget != null && used > budget
  const color = over ? 'bg-red-500' : pct > 0.85 ? 'bg-yellow-500' : 'bg-green-500'
  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <span className="text-gray-300">{label}</span>
        <span className="text-gray-400">
          {budget == null ? (
            <>{format(used)} used · <span className="text-gray-500">no budget set</span></>
          ) : (
            <>
              {format(used)} of {format(budget)} ·{' '}
              <span className={over ? 'text-red-400 font-medium' : 'text-gray-300'}>
                {over ? `${format(used - budget)} over` : `${format(budget - used)} left`}
              </span>
            </>
          )}
        </span>
      </div>
      <div className="h-2.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.max(pct * 100, budget ? 1 : 0)}%` }} />
      </div>
    </div>
  )
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-lg font-semibold">{children}</h2>
      {right}
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-500 text-sm">{children}</div>
  )
}
