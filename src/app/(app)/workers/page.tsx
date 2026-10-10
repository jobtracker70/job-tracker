import { createServiceClient } from '@/lib/supabase'
import { fmtDate, money, todaySydney } from '@/lib/format'
import { Card, Empty, SectionTitle, inputClass, secondaryButtonClass } from '@/components/ui'
import { AddWorkerForm, RateFields, WORKER_TYPES } from './add-worker-form'
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
  subbie: 'Subbie (hourly)',
  subbie_fixed: 'Subbie (fixed price)',
}

export default async function WorkersPage() {
  const { data } = await createServiceClient()
    .from('workers')
    .select('id, name, phone, type, abn, active, break_minutes, worker_rates(base_rate, oncost_mult, effective_from, weekend_rate, overtime_rate, overtime_after)')
    .order('active', { ascending: false })
    .order('name')
  const workers = (data ?? []) as Worker[]
  const today = todaySydney()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Workers &amp; subbies</h1>
        <p className="text-gray-400 text-sm mt-1">
          Their WhatsApp number is how the bot knows who is signing in. Rates and breaks turn hours into labour cost.
        </p>
      </div>

      <section>
        <SectionTitle>Add someone</SectionTitle>
        <Card><AddWorkerForm /></Card>
      </section>

      <section>
        <SectionTitle>Team</SectionTitle>
        {!workers.length ? (
          <Empty>No workers yet.</Empty>
        ) : (
          <div className="space-y-3">
            {workers.map((w) => {
              const rates = [...w.worker_rates].sort((a, b) => b.effective_from.localeCompare(a.effective_from))
              const current = rates.find((r) => r.effective_from <= today) ?? null
              const subbie = w.type === 'subbie' || w.type === 'subbie_fixed'
              return (
                <details key={w.id} className={`bg-gray-900 border border-gray-800 rounded-xl ${w.active ? '' : 'opacity-50'}`}>
                  <summary className="px-5 py-4 cursor-pointer flex flex-wrap items-center gap-x-5 gap-y-1">
                    <span className="font-semibold">{w.name}</span>
                    <span className="text-xs bg-gray-800 px-2 py-0.5 rounded">{TYPE_LABEL[w.type] ?? w.type}</span>
                    <span className="text-gray-400 text-sm font-mono">{w.phone}</span>
                    <span className="text-gray-400 text-sm">{w.break_minutes ? `${w.break_minutes} min unpaid break` : 'No unpaid break'}</span>
                    <span className="text-sm ml-auto text-right">
                      {w.type === 'subbie_fixed' ? (
                        <span className="text-gray-400">Costed from invoices</span>
                      ) : current ? (
                        <>
                          {money(Number(current.base_rate))}/h
                          {!subbie && (
                            <span className="text-gray-500">
                              {' '}× {Number(current.oncost_mult)} on-costs
                              {current.weekend_rate != null && ` · weekend ${money(Number(current.weekend_rate))}/h`}
                              {current.overtime_rate != null && ` · overtime ${money(Number(current.overtime_rate))}/h after ${Number(current.overtime_after)}h`}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-yellow-400">No rate set — labour shows $0</span>
                      )}
                    </span>
                    {!w.active && <span className="text-xs text-gray-500">inactive</span>}
                  </summary>

                  <div className="px-5 pb-5 grid md:grid-cols-2 gap-6">
                    {w.type !== 'subbie_fixed' ? (
                      <form action={setRate.bind(null, w.id, w.type)} className="space-y-3">
                        <h3 className="text-sm font-semibold text-gray-300">Change rates</h3>
                        <div className="grid grid-cols-2 gap-2">
                          <RateFields type={w.type} defaults={{ oncost: current?.oncost_mult, overtimeAfter: current?.overtime_after }} />
                          <label className="text-sm">
                            <span className="text-gray-300">Starting from</span>
                            <input name="effective_from" type="date" defaultValue={today} className={`${inputClass} mt-1`} />
                          </label>
                        </div>
                        <button className={secondaryButtonClass}>Save rates</button>
                        {rates.length > 0 && (
                          <ul className="text-xs text-gray-500 space-y-0.5">
                            {rates.map((r) => (
                              <li key={r.effective_from + r.base_rate}>
                                From {fmtDate(r.effective_from)}: {money(Number(r.base_rate))}/h
                                {!subbie && ` × ${Number(r.oncost_mult)}`}
                                {r.weekend_rate != null && `, weekend ${money(Number(r.weekend_rate))}`}
                                {r.overtime_rate != null && `, overtime ${money(Number(r.overtime_rate))} after ${Number(r.overtime_after)}h`}
                              </li>
                            ))}
                          </ul>
                        )}
                      </form>
                    ) : (
                      <p className="text-sm text-gray-400">
                        Fixed-price subbies have no hourly rate. Their cost comes from the invoices they send.
                      </p>
                    )}

                    <form action={updateWorker.bind(null, w.id)} className="space-y-3">
                      <h3 className="text-sm font-semibold text-gray-300">Details</h3>
                      <input name="name" defaultValue={w.name} className={inputClass} />
                      <input name="phone" defaultValue={w.phone} className={inputClass} />
                      <select name="type" defaultValue={w.type} className={inputClass}>
                        {WORKER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <label className="block text-sm">
                        <span className="text-gray-300">Unpaid lunch break (minutes) — 0 if none</span>
                        <input name="break_minutes" inputMode="numeric" defaultValue={w.break_minutes} className={`${inputClass} mt-1`} />
                      </label>
                      <input name="abn" defaultValue={w.abn ?? ''} placeholder="ABN" className={inputClass} />
                      <div className="flex gap-2">
                        <button className={secondaryButtonClass}>Save details</button>
                        <button formAction={setActive.bind(null, w.id, !w.active)} className={secondaryButtonClass}>
                          {w.active ? 'Mark inactive' : 'Mark active'}
                        </button>
                      </div>
                    </form>
                  </div>
                </details>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
