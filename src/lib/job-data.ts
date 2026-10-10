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
  invoice_number: string | null; image_path: string | null; source: string; note: string | null
}
export type SubbieRow = { key: string; name: string; fixed: boolean; logged: number; invoiced: number; amount: number; linked: boolean }

export const isSubbieType = (t: string) => t === 'subbie' || t === 'subbie_fixed'

export async function loadJob(id: string) {
  const supabase = createServiceClient()
  const [{ data: summary }, { data: job }, { data: entriesData }, { data: expensesData }, { data: variations }, { data: subbies }] =
    await Promise.all([
      supabase.from('job_summary').select('*').eq('id', id).maybeSingle(),
      supabase.from('jobs').select('quote_pdf_path, po_ref, decided_at, completed_at').eq('id', id).maybeSingle(),
      supabase.from('time_entry_costs').select('*').eq('job_id', id).order('start_time', { ascending: false }),
      supabase
        .from('expenses')
        .select('id, supplier, total, gst, amount_ex_gst, is_credit, hours, expense_date, status, category, worker_id, invoice_number, image_path, source, note')
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
