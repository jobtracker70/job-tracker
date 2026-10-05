import { createServiceClient } from '@/lib/supabase'
import { fmtDate, money, todaySydney } from '@/lib/format'
import { Card, Empty, SectionTitle, inputClass, secondaryButtonClass } from '@/components/ui'
import { AddWorkerForm } from './add-worker-form'
import { setActive, setRate, updateWorker } from './actions'

export const dynamic = 'force-dynamic'

type Worker = {
  id: string; name: string; phone: string; type: string; abn: string | null; active: boolean
  worker_rates: { base_rate: number; oncost_mult: number; effective_from: string }[]
}

export default async function WorkersPage() {
  const { data } = await createServiceClient()
    .from('workers')
    .select('id, name, phone, type, abn, active, worker_rates(base_rate, oncost_mult, effective_from)')
    .order('active', { ascending: false })
    .order('name')
  const workers = (data ?? []) as Worker[]
  const today = todaySydney()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Workers &amp; subbies</h1>
        <p className="text-gray-400 text-sm mt-1">
          Their WhatsApp number is how the bot knows who is clocking in. Rates turn hours into labour cost.
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
              return (
                <details key={w.id} className={`bg-gray-900 border border-gray-800 rounded-xl ${w.active ? '' : 'opacity-50'}`}>
                  <summary className="px-5 py-4 cursor-pointer flex flex-wrap items-center gap-x-6 gap-y-1">
                    <span className="font-semibold">{w.name}</span>
                    <span className="text-xs bg-gray-800 px-2 py-0.5 rounded capitalize">{w.type}</span>
                    <span className="text-gray-400 text-sm font-mono">{w.phone}</span>
                    <span className="text-sm ml-auto">
                      {current ? (
                        <>
                          {money(Number(current.base_rate))}/h
                          {w.type !== 'subbie' && (
                            <span className="text-gray-500"> × {Number(current.oncost_mult)} = {money(Number(current.base_rate) * Number(current.oncost_mult))}/h cost</span>
                          )}
                        </>
                      ) : (
                        <span className="text-yellow-400">No rate set — labour shows $0</span>
                      )}
                    </span>
                    {!w.active && <span className="text-xs text-gray-500">inactive</span>}
                  </summary>

                  <div className="px-5 pb-5 grid md:grid-cols-2 gap-6">
                    <form action={setRate.bind(null, w.id)} className="space-y-3">
                      <h3 className="text-sm font-semibold text-gray-300">Change rate</h3>
                      <div className="grid grid-cols-3 gap-2">
                        <input name="rate" required inputMode="decimal" placeholder="$/hour" className={inputClass} />
                        <input name="oncost" inputMode="decimal" defaultValue={w.type === 'subbie' ? '1' : String(current?.oncost_mult ?? 1.4)} title="On-costs multiplier" className={inputClass} />
                        <input name="effective_from" type="date" defaultValue={today} className={inputClass} />
                      </div>
                      <button className={secondaryButtonClass}>Save rate</button>
                      {rates.length > 0 && (
                        <ul className="text-xs text-gray-500 space-y-0.5">
                          {rates.map((r) => (
                            <li key={r.effective_from + r.base_rate}>
                              From {fmtDate(r.effective_from)}: {money(Number(r.base_rate))}/h × {Number(r.oncost_mult)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </form>

                    <form action={updateWorker.bind(null, w.id)} className="space-y-3">
                      <h3 className="text-sm font-semibold text-gray-300">Details</h3>
                      <input name="name" defaultValue={w.name} className={inputClass} />
                      <input name="phone" defaultValue={w.phone} className={inputClass} />
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
