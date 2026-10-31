import { money } from '@/lib/format'

type Slice = { label: string; value: number; color: string }

// Where the job's money went: a ring split into labour, subbies, materials and profit (or loss), with labelled values
export function CostPie({ labour, subbies, materials, income }: { labour: number; subbies: number; materials: number; income: number }) {
  const costs = labour + subbies + materials
  const profit = income - costs
  const slices: Slice[] = [
    { label: 'Labour', value: labour, color: '#1D5FD8' },
    { label: 'Subbies', value: subbies, color: '#E8890C' },
    { label: 'Materials', value: materials, color: '#9333EA' },
    ...(profit > 0 ? [{ label: 'Profit', value: profit, color: '#15803D' }] : []),
  ].filter((s) => s.value > 0)
  const total = slices.reduce((s, x) => s + x.value, 0)
  if (total <= 0) return <p className="text-faint text-sm">No costs or income yet.</p>

  const R = 70, C = 2 * Math.PI * R
  let offset = 0
  return (
    <div className="flex flex-wrap items-center gap-8">
      <svg viewBox="0 0 180 180" className="w-44 h-44 shrink-0" role="img" aria-label="Where the money went">
        <g transform="rotate(-90 90 90)">
          {slices.map((s) => {
            const len = (s.value / total) * C
            const el = (
              <circle key={s.label} cx="90" cy="90" r={R} fill="none" stroke={s.color} strokeWidth="26"
                strokeDasharray={`${Math.max(0, len - 2)} ${C - Math.max(0, len - 2)}`} strokeDashoffset={-offset}>
                <title>{`${s.label}: ${money(s.value)} (${Math.round((s.value / total) * 100)}%)`}</title>
              </circle>
            )
            offset += len
            return el
          })}
        </g>
        <text x="90" y="86" textAnchor="middle" className="fill-[var(--color-muted)]" style={{ fontSize: 12 }}>{profit >= 0 ? 'Profit' : 'Loss'}</text>
        <text x="90" y="106" textAnchor="middle" className={profit >= 0 ? 'fill-[var(--color-good)]' : 'fill-[var(--color-bad)]'} style={{ fontSize: 20, fontWeight: 800 }}>{money(Math.abs(profit))}</text>
      </svg>
      <ul className="space-y-2.5 text-sm min-w-48">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-3">
            <span className="w-3.5 h-3.5 rounded-[4px] shrink-0" style={{ background: s.color }} />
            <span className="flex-1 font-medium">{s.label}</span>
            <span className="font-semibold tabular-nums">{money(s.value)}</span>
            <span className="text-faint w-11 text-right tabular-nums">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
        {profit < 0 && <li className="text-bad font-semibold pt-1">Costs are {money(-profit)} more than the income.</li>}
        <li className="text-faint text-xs pt-1">Share of {profit >= 0 ? 'the income' : 'all costs'}, ex GST.</li>
      </ul>
    </div>
  )
}
