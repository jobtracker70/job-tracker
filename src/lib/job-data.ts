import { createServiceClient } from './supabase'
import { forecast, jobNumbers, type JobSummary } from './forecast'

export type JobEntry = {
  id: string; worker_id: string; worker_name: string; worker_type: string
  start_time: string; end_time: string | null; needs_review: boolean; review_reason: string | null
  work_day: string; is_weekend: boolean; raw_hours: number; paid_hours: number; overtime_hours: number
  cost: number; has_rate: boolean
}
export type JobExpense = {
  id: string; supplier: string | null; total: number; gst: number | null; amount_ex_gst: number; is_credit: boolean
  hours: number | null; expense_date: string | null; status: string; category: string; worker_id: string | null
  invoice_number: string | null; image_path: string | null; source: string; note: string | null; line_items: unknown
}
export type SubbieRow = { key: string; name: string; fixed: boolean; logged: number; invoiced: number; amount: number; linked: boolean }

export const isSubbieType = (t: string) => t === 'subbie' || t === 'subbie_fixed'

export async function loadJob(id: string) {
  const supabase = createServiceClient()
  const [{ data: summary }, { data: job }, { data: entriesData }, { data: expensesData }, { data: variations }, { data: subbies }] =
    await Promise.all([
      supabase.from('job_summary').select('*').eq('id', id).maybeSingle(),
      supabase.from('jobs').select('quote_pdf_path, po_ref, decided_at, completed_at, day_start, day_end').eq('id', id).maybeSingle(),
      supabase.from('time_entry_costs').select('*').eq('job_id', id).order('start_time', { ascending: false }),
      supabase
        .from('expenses')
        .select('id, supplier, total, gst, amount_ex_gst, is_credit, hours, expense_date, status, category, worker_id, invoice_number, image_path, source, note, line_items')
        .eq('job_id', id)
        .order('expense_date', { ascending: false }),
      supabase.from('variations').select('id, description, amount, hours, materials, created_at').eq('job_id', id).order('created_at'),
      supabase.from('workers').select('id, name, type').in('type', ['subbie', 'subbie_fixed']),
    ])
  if (!summary || !job) return null

  const j = summary as JobSummary
  const entries = (entriesData ?? []) as JobEntry[]
  const expenses = (expensesData ?? []) as JobExpense[]

  // Subbie hours: what each subbie logged on WhatsApp vs what they invoiced
  const subbieInfo = new Map((subbies ?? []).map((s) => [s.id, s as { id: string; name: string; type: string }]))
  const rows = new Map<string, SubbieRow>()
  for (const e of entries) {
    if (!isSubbieType(e.worker_type)) continue
    const r = rows.get(e.worker_id) ?? {
      key: e.worker_id, name: e.worker_name, fixed: e.worker_type === 'subbie_fixed', logged: 0, invoiced: 0, amount: 0, linked: true,
    }
    r.logged += Number(e.paid_hours)
    rows.set(e.worker_id, r)
  }
  for (const x of expenses) {
    if (x.category !== 'subbie' || x.status === 'rejected') continue
    const key = x.worker_id ?? `supplier:${x.supplier ?? 'Unknown'}`
    const info = x.worker_id ? subbieInfo.get(x.worker_id) : undefined
    const r = rows.get(key) ?? {
      key,
      name: info?.name ?? x.supplier ?? 'Unknown subbie',
      fixed: info?.type === 'subbie_fixed',
      logged: 0, invoiced: 0, amount: 0, linked: !!x.worker_id,
    }
    r.invoiced += Number(x.hours ?? 0)
    r.amount += Number(x.amount_ex_gst)
    rows.set(key, r)
  }
  const subbieRows = [...rows.values()]
  const subbieHours = subbieRows.reduce((s, r) => s + Math.max(r.invoiced, r.logged), 0)

  const nums = jobNumbers(j, subbieHours)
  const f = forecast(j, nums)

  return { j, job, entries, expenses, variations: variations ?? [], subbieRows, nums, f, supabase }
}

// Monday (YYYY-MM-DD) of the week a work day falls in
export function weekOf(day: string) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

export type PersonWeek = { week: string; days: number; hours: number; cost: number; shifts: number }
export type PersonSummary = {
  workerId: string; name: string; type: string; hours: number; cost: number; shifts: number; days: number
  weeks: PersonWeek[]; firstDay: string; lastDay: string
}

// Hours on a job per person, and per person per week (newest week first)
export function peopleOnJob(entries: JobEntry[]): PersonSummary[] {
  const map = new Map<string, PersonSummary & { daySet: Set<string>; weekMap: Map<string, PersonWeek & { daySet: Set<string> }> }>()
  for (const e of entries) {
    const p = map.get(e.worker_id) ?? {
      workerId: e.worker_id, name: e.worker_name, type: e.worker_type, hours: 0, cost: 0, shifts: 0, days: 0,
      weeks: [], firstDay: e.work_day, lastDay: e.work_day, daySet: new Set<string>(), weekMap: new Map(),
    }
    p.hours += Number(e.paid_hours)
    p.cost += Number(e.cost)
    p.shifts++
    p.daySet.add(e.work_day)
    if (e.work_day < p.firstDay) p.firstDay = e.work_day
    if (e.work_day > p.lastDay) p.lastDay = e.work_day
    const wk = weekOf(e.work_day)
    const w = p.weekMap.get(wk) ?? { week: wk, days: 0, hours: 0, cost: 0, shifts: 0, daySet: new Set<string>() }
    w.hours += Number(e.paid_hours)
    w.cost += Number(e.cost)
    w.shifts++
    w.daySet.add(e.work_day)
    p.weekMap.set(wk, w)
    map.set(e.worker_id, p)
  }
  return [...map.values()]
    .map(({ daySet, weekMap, ...p }) => ({
      ...p,
      days: daySet.size,
      weeks: [...weekMap.values()].map(({ daySet: ds, ...w }) => ({ ...w, days: ds.size })).sort((a, b) => b.week.localeCompare(a.week)),
    }))
    .sort((a, b) => b.hours - a.hours)
}

// "6 Oct – 12 Oct"
export function weekLabel(monday: string) {
  const s = new Date(`${monday}T00:00:00Z`)
  const e = new Date(s)
  e.setUTCDate(e.getUTCDate() + 6)
  const f = (d: Date) => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${f(s)} – ${f(e)}`
}
