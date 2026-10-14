import { createServiceClient } from '@/lib/supabase'
import { fmtDate, money, todaySydney } from '@/lib/format'
import { Pill, buttonClass, cardClass, inputClass, secondaryButtonClass } from '@/components/ui'
import { AddWorkerForm, PayOptions } from './add-worker-form'
import { WORKER_TYPES } from '@/lib/workers'
import { setActive, setRate, updateWorker } from './actions'

export const dynamic = 'force-dynamic'

type Rate = {
  base_rate: number; oncost_mult: number; effective_from: string
  weekend_rate: number | null; overtime_rate: number | null; overtime_after: number
}
type Worker = {
  id: string; name: string; phone: string; type: string; abn: string | null; active: boolean; break_minutes: number
  worker_rates: Rate[]
}

const TYPE_LABEL: Record<string, string> = {
  employee: 'Employee',
  apprentice: 'Apprentice',
  subbie: 'Subbie',
  subbie_fixed: 'Subbie fixed price',
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')

export default async function WorkersPage() {
  const { data } = await createServiceClient()
    .from('workers')
    .select('id, name, phone, type, abn, active, break_minutes, worker_rates(base_rate, oncost_mult, effective_from, weekend_rate, overtime_rate, overtime_after)')
    .order('name')
  const workers = (data ?? []) as Worker[]
  const today = todaySydney()
  const active = workers.filter((w) => w.active)
  const inactive = workers.filter((w) => !w.active)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] md:text-[32px] font-bold leading-tight">Workers</h1>
        <details className="group relative">
          <summary className={`${buttonClass} cursor-pointer`}>+ Add worker</summary>
          <div className={`${cardClass} absolute right-0 z-10 mt-2 w-[min(92vw,380px)] p-4`}>
            <AddWorkerForm />
          </div>
        </details>
      </div>

      <Group title="Active" workers={active} today={today} />
      {inactive.length > 0 && <Group title="Not working now" workers={inactive} today={today} />}
      {!workers.length && <div className={`${cardClass} p-8 text-center text-muted`}>No workers yet. Add your crew so they can sign in on WhatsApp.</div>}
    </div>
  )
}

function Group({ title, workers, today }: { title: string; workers: Worker[]; today: string }) {
  if (!workers.length) return null
  return (
    <section>
      <h2 className="text-lg font-bold mb-3">{title} <span className="text-muted font-normal">({workers.length})</span></h2>
      <div className={cardClass}>
        {workers.map((w) => <WorkerRow key={w.id} w={w} today={today} />)}
      </div>
    </section>
  )
}

function WorkerRow({ w, today }: { w: Worker; today: string }) {
  const rates = [...w.worker_rates].sort((a, b) => b.effective_from.localeCompare(a.effective_from))
  const current = rates.find((r) => r.effective_from <= today) ?? null
  const subbie = w.type === 'subbie' || w.type === 'subbie_fixed'
  const rateText = w.type === 'subbie_fixed' ? 'Fixed price' : current ? `${money(Number(current.base_rate))}/h` : 'No rate'

  return (
    <details className={`group border-b border-line last:border-0 ${w.active ? '' : 'opacity-70'}`}>
      <summary className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-page/60">
        <span className="w-10 h-10 shrink-0 rounded-full bg-brand-tint text-brand font-bold grid place-items-center text-sm">{initials(w.name)}</span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold truncate">{w.name}</span>
          <span className="block text-sm text-muted">{TYPE_LABEL[w.type] ?? w.type}</span>
        </span>
        <span className={`font-semibold ${!current && w.type !== 'subbie_fixed' ? 'text-warn' : ''}`}>{rateText}</span>
        <span className="text-faint transition group-open:rotate-90">›</span>
      </summary>

      <div className="px-4 pb-5 grid md:grid-cols-2 gap-6">
        {w.type !== 'subbie_fixed' ? (
          <form action={setRate.bind(null, w.id, w.type)} className="space-y-3">
            <h3 className="font-semibold">Pay</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="text-sm font-medium">{subbie ? 'Hourly rate ($)' : 'Pay rate ($/h)'}</span>
                <input name="rate" required inputMode="decimal" defaultValue={current?.base_rate ?? ''} className={`${inputClass} mt-1.5`} /></label>
              <label className="block"><span className="text-sm font-medium">Starting from</span>
                <input name="effective_from" type="date" defaultValue={today} className={`${inputClass} mt-1.5 !px-2`} /></label>
            </div>
            <details>
              <summary className="text-sm text-brand font-semibold cursor-pointer">More pay options</summary>
              <div className="mt-3">
                <PayOptions type={w.type} defaults={{ oncost: current?.oncost_mult, overtimeAfter: current?.overtime_after, breakMinutes: w.break_minutes, abn: w.abn }} />
              </div>
            </details>
            <button className={secondaryButtonClass}>Save pay</button>
            {rates.length > 0 && (
              <ul className="text-xs text-faint space-y-0.5">
                {rates.map((r) => (
                  <li key={r.effective_from + r.base_rate}>
                    From {fmtDate(r.effective_from)}: {money(Number(r.base_rate))}/h
                    {r.weekend_rate != null && `, weekend ${money(Number(r.weekend_rate))}`}
                    {r.overtime_rate != null && `, overtime ${money(Number(r.overtime_rate))} after ${Number(r.overtime_after)}h`}
                  </li>
                ))}
              </ul>
            )}
          </form>
        ) : (
          <p className="text-sm text-muted">Fixed-price subbies have no hourly rate. Their cost comes from their invoices.</p>
        )}

        <form action={updateWorker.bind(null, w.id)} className="space-y-3">
          <h3 className="font-semibold">Details</h3>
          <input name="name" defaultValue={w.name} className={inputClass} />
          <input name="phone" defaultValue={w.phone} inputMode="tel" className={inputClass} />
          <select name="type" defaultValue={w.type} className={inputClass}>
            {WORKER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-sm font-medium">Unpaid break (min)</span>
              <input name="break_minutes" inputMode="numeric" defaultValue={w.break_minutes} className={`${inputClass} mt-1.5`} /></label>
            <label className="block"><span className="text-sm font-medium">ABN</span>
              <input name="abn" defaultValue={w.abn ?? ''} className={`${inputClass} mt-1.5`} /></label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={secondaryButtonClass}>Save details</button>
            <button formAction={setActive.bind(null, w.id, !w.active)} className={secondaryButtonClass}>
              {w.active ? 'Mark not working' : 'Mark working'}
            </button>
          </div>
          {w.active ? null : <Pill tone="neutral">Not working now</Pill>}
        </form>
      </div>
    </details>
  )
}
