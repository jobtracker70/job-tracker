import Link from 'next/link'

export const inputClass =
  'w-full bg-white border border-line rounded-xl px-3.5 py-2.5 text-ink placeholder-faint focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand'

export const buttonClass =
  'inline-flex items-center justify-center gap-2 bg-brand text-white hover:bg-brand-dark disabled:opacity-50 px-4 py-2.5 rounded-xl font-semibold text-sm transition'

export const secondaryButtonClass =
  'inline-flex items-center justify-center gap-2 bg-white text-brand border border-line hover:bg-brand-tint disabled:opacity-50 px-4 py-2.5 rounded-xl font-semibold text-sm transition'

export const dangerButtonClass =
  'inline-flex items-center justify-center gap-2 bg-white text-bad border border-bad/30 hover:bg-bad-tint disabled:opacity-50 px-4 py-2.5 rounded-xl font-semibold text-sm transition'

export const cardClass = 'bg-white border border-line rounded-2xl shadow-[0_1px_2px_rgba(15,27,45,0.04),0_4px_12px_rgba(15,27,45,0.04)]'

export type Tone = 'good' | 'warn' | 'bad' | 'brand' | 'neutral'

const PILL: Record<Tone, string> = {
  good: 'bg-good-tint text-good',
  warn: 'bg-warn-tint text-warn',
  bad: 'bg-bad-tint text-bad',
  brand: 'bg-brand-tint text-brand',
  neutral: 'bg-slate-100 text-muted',
}

export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-sm font-semibold ${PILL[tone]}`}>{children}</span>
}

export function SmallTag({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PILL[tone]}`}>{children}</span>
}

// Kept for older call sites: job status as a pill
const STATUS: Record<string, { label: string; tone: Tone }> = {
  quoted: { label: 'Quote', tone: 'brand' },
  active: { label: 'Active', tone: 'brand' },
  complete: { label: 'Finished', tone: 'neutral' },
  invoiced: { label: 'Invoiced', tone: 'neutral' },
  paid: { label: 'Paid', tone: 'good' },
  rejected: { label: 'Lost', tone: 'bad' },
}
export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: 'neutral' as Tone }
  return <Pill tone={s.tone}>{s.label}</Pill>
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`${cardClass} p-5 ${className}`}>{children}</div>
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'green' | 'red' | 'yellow' }) {
  const color = tone === 'green' ? 'text-good' : tone === 'red' ? 'text-bad' : tone === 'yellow' ? 'text-warn' : 'text-ink'
  return (
    <div className={`${cardClass} p-4`}>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-muted text-sm mt-0.5">{label}</p>
      {sub && <p className="text-faint text-xs mt-1">{sub}</p>}
    </div>
  )
}

export function ProgressBar({ label, used, budget, format }: { label: string; used: number; budget: number | null; format: (n: number) => string }) {
  const pct = budget ? Math.min(used / budget, 1) : 0
  const over = budget != null && used > budget
  const warn = !over && pct > 0.85
  const fill = over ? 'bg-bad' : warn ? 'bg-warn-bar' : 'bg-brand'
  const textTone = over ? 'text-bad' : warn ? 'text-warn' : 'text-ink'
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-sm font-medium text-muted">{label}</span>
        <span className={`text-sm font-semibold ${textTone}`}>
          {budget == null ? `${format(used)} · no budget` : `${format(used)} of ${format(budget)}${over ? `, ${format(used - budget)} over` : ''}`}
        </span>
      </div>
      <div className="h-2.5 bg-line rounded-full overflow-hidden">
        <div className={`h-full ${fill} rounded-full`} style={{ width: `${Math.max(pct * 100, budget && used > 0 ? 2 : 0)}%` }} />
      </div>
    </div>
  )
}
export const BudgetBar = ProgressBar

export function PageTitle({ children, right, back }: { children: React.ReactNode; right?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && <Link href={back.href} className="text-brand text-sm font-medium hover:underline print:hidden">← {back.label}</Link>}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-1">
        <h1 className="text-[28px] md:text-[32px] font-bold leading-tight">{children}</h1>
        {right}
      </div>
    </div>
  )
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h2 className="text-lg font-bold">{children}</h2>
      {right}
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className={`${cardClass} p-8 text-center text-muted`}>{children}</div>
}

// A tappable row that opens to show detail (no JavaScript needed)
export function Collapsible({ title, summary, summaryTone, children, open = false }: {
  title: string; summary?: React.ReactNode; summaryTone?: 'bad' | 'good'; children: React.ReactNode; open?: boolean
}) {
  return (
    <details open={open} className="group border-b border-line last:border-0">
      <summary className="flex items-center justify-between gap-3 px-4 py-4 cursor-pointer hover:bg-page/60">
        <span>
          <span className="block text-[17px] font-bold text-ink">{title}</span>
          {summary && <span className={`block text-sm ${summaryTone === 'bad' ? 'text-bad' : summaryTone === 'good' ? 'text-good' : 'text-muted'}`}>{summary}</span>}
        </span>
        <span className="text-faint text-xl transition group-open:rotate-90">›</span>
      </summary>
      <div className="mx-3 mb-3 rounded-xl bg-page/70 border border-line px-3 py-2 text-ink">{children}</div>
    </details>
  )
}

export function AlertBar({ tone = 'bad', children, action }: { tone?: 'bad' | 'warn'; children: React.ReactNode; action?: React.ReactNode }) {
  const cls = tone === 'bad' ? 'bg-bad-tint border-bad/20 text-bad' : 'bg-warn-tint border-warn/20 text-warn'
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 border rounded-2xl px-4 py-3 ${cls}`}>
      <span className="font-medium">⚠ {children}</span>
      {action}
    </div>
  )
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="16" fill="#1D5FD8" />
        <path d="M44 14 26 34" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
        <path d="M24 36c-6 0-9 4-9 9 0 3-2 5-4 5 3 2 7 3 11 2 5-1 8-5 7-10l-5-6z" fill="#fff" />
      </svg>
      <span className="text-xl font-bold tracking-tight">BrushBooks</span>
    </span>
  )
}
