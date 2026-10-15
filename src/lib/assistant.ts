import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from './supabase'
import { sealPayload } from './auth'
import { forecast, jobNumbers, type JobSummary } from './forecast'
import { jobPill } from './status'
import { fmtClock, fmtDate, fmtDuration, sydneyDateOf, sydneyLocalToISO, todaySydney } from './format'
import { itemsOf } from './items'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-5-5'
const MAX_TURNS = 8
const MAX_SHIFT_HOURS = 16

type Supabase = ReturnType<typeof createServiceClient>

// ---------- Changes the AI can propose (the owner must press Confirm) ----------

export type Change =
  | { kind: 'change_shift'; shiftId: string; start: string; end: string | null; jobId: string }
  | { kind: 'add_shift'; workerId: string; jobId: string; start: string; end: string }
  | { kind: 'move_invoice'; invoiceId: string; jobId: string | null }

export type Proposal = { summary: string; token: string }

const EXPIRES_MIN = 30
const seal = (change: Change) => sealPayload({ change, exp: Date.now() + EXPIRES_MIN * 60000 })

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Sydney' })
const span = (start: string, end: string | null) =>
  `${fmtClock(start)}–${end ? fmtClock(end) : 'still on site'}${end ? ` (${fmtDuration((new Date(end).getTime() - new Date(start).getTime()) / 3600000)})` : ''}`
const site = (j: { address: string | null; code: string } | null | undefined) => j?.address ?? j?.code ?? 'no job'

function readTimes(date: string, start: string, end: string | null) {
  const s = sydneyLocalToISO(`${date}T${start}`)
  const e = end ? sydneyLocalToISO(`${date}T${end}`) : null
  if (!s) return { error: `Start time "${start}" on ${date} is not valid. Use HH:MM (24 hour) and YYYY-MM-DD.` }
  if (end && !e) return { error: `Finish time "${end}" is not valid. Use HH:MM (24 hour).` }
  if (e && new Date(e) <= new Date(s)) return { error: 'Finish must be after start.' }
  if (e && new Date(e).getTime() - new Date(s).getTime() > MAX_SHIFT_HOURS * 3600000) return { error: 'That shift is over 16 hours.' }
  if (new Date(s).getTime() > Date.now() + 5 * 60000) return { error: 'That start time is in the future.' }
  return { start: s, end: e }
}

// ---------- Tools ----------

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'list_jobs',
    description: 'All jobs with their money and hours so far. Use to find a job by address, client or code, or to compare jobs.',
    input_schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['active', 'quoted', 'finished', 'lost', 'all'], description: 'Default: all' } },
    },
  },
  {
    name: 'list_workers',
    description: 'All workers (employees, apprentices, subbies) with their ids, type, current pay rate and whether they are working now.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_shifts',
    description:
      'Shifts (signed-in hours) with paid hours (unpaid breaks taken off) and labour cost. Filter by worker, job and/or date range. Returns each shift with its id plus totals.',
    input_schema: {
      type: 'object',
      properties: {
        worker_id: { type: 'string' },
        job_id: { type: 'string' },
        from: { type: 'string', description: 'YYYY-MM-DD (Sydney date), inclusive' },
        to: { type: 'string', description: 'YYYY-MM-DD (Sydney date), inclusive' },
      },
    },
  },
  {
    name: 'get_invoices',
    description: 'Supplier and subbie invoices/receipts with amounts ex GST and the items on them. Filter by job, supplier name, date range or status.',
    input_schema: {
      type: 'object',
      properties: {
        job_id: { type: 'string' },
        supplier: { type: 'string', description: 'Part of the supplier name, e.g. "bunnings"' },
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
        status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'all'], description: 'Default: all except rejected' },
      },
    },
  },
  {
    name: 'who_is_on_site',
    description: 'Who is signed in right now, and which active workers have not signed in today.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'propose_change_shift',
    description:
      'Propose changing an existing shift (times and/or job). Does NOT change anything: the owner sees the change and must press Confirm. Get the shift_id from get_shifts first.',
    input_schema: {
      type: 'object',
      properties: {
        shift_id: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD Sydney date of the shift (keep the same day unless asked)' },
        start: { type: 'string', description: 'HH:MM 24 hour, Sydney time' },
        end: { type: 'string', description: 'HH:MM 24 hour, Sydney time. Omit only if the person is still on site.' },
        job_id: { type: 'string', description: 'Only if moving the shift to another job' },
      },
      required: ['shift_id', 'date', 'start'],
    },
  },
  {
    name: 'propose_add_shift',
    description: 'Propose adding hours for a worker who forgot to sign in. Does NOT change anything until the owner presses Confirm.',
    input_schema: {
      type: 'object',
      properties: {
        worker_id: { type: 'string' },
        job_id: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        start: { type: 'string', description: 'HH:MM 24 hour' },
        end: { type: 'string', description: 'HH:MM 24 hour' },
      },
      required: ['worker_id', 'job_id', 'date', 'start', 'end'],
    },
  },
  {
    name: 'propose_move_invoice',
    description:
      'Propose moving an invoice to another job (or off all jobs, back to "needs checking", with job_id null). Does NOT change anything until the owner presses Confirm.',
    input_schema: {
      type: 'object',
      properties: { invoice_id: { type: 'string' }, job_id: { type: ['string', 'null'] } },
      required: ['invoice_id', 'job_id'],
    },
  },
]

type Input = Record<string, string | null | undefined>
const dayStartIso = (d: string) => sydneyLocalToISO(`${d}T00:00`)
const nextDayIso = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`)
  x.setUTCDate(x.getUTCDate() + 1)
  return sydneyLocalToISO(`${x.toISOString().slice(0, 10)}T00:00`)
}
const r2 = (n: number) => Math.round(n * 100) / 100

async function runTool(supabase: Supabase, name: string, input: Input, proposals: Proposal[]): Promise<unknown> {
  switch (name) {
    case 'list_jobs': {
      const { data } = await supabase.from('job_summary').select('*').order('created_at', { ascending: false })
      const groups: Record<string, string[]> = { active: ['active'], quoted: ['quoted'], finished: ['complete', 'invoiced', 'paid'], lost: ['rejected'] }
      const want = input.status && input.status !== 'all' ? groups[input.status] : null
      return ((data ?? []) as JobSummary[])
        .filter((j) => !want || want.includes(j.status))
        .map((j) => {
          const nums = jobNumbers(j)
          const f = forecast(j, nums)
          return {
            id: j.id, code: j.code, address: j.address, client: j.client_name, status: jobPill(j, f).label,
            start_date: j.start_date, planned_finish: j.planned_finish,
            income_ex_gst: r2(nums.income), costs_so_far: r2(nums.costs), profit_so_far: r2(nums.profit),
            margin_pct: nums.margin == null ? null : Math.round(nums.margin * 100),
            hours_used: r2(nums.hoursUsed), hours_budget: nums.hoursBudget, labour_cost: r2(nums.labourCost),
            materials_cost: r2(nums.materialsCost), materials_budget: nums.materialsBudget,
            projected_profit: f.projectedProfit == null ? null : r2(f.projectedProfit),
            shifts_to_check: j.entries_to_review, rejection_reason: j.rejection_reason,
          }
        })
    }

    case 'list_workers': {
      const { data } = await supabase
        .from('workers')
        .select('id, name, type, active, break_minutes, worker_rates(base_rate, effective_from, weekend_rate, overtime_rate, overtime_after)')
        .order('name')
      const today = todaySydney()
      return (data ?? []).map((w) => {
        const rates = [...(w.worker_rates ?? [])].sort((a, b) => b.effective_from.localeCompare(a.effective_from))
        const current = rates.find((r) => r.effective_from <= today)
        return {
          id: w.id, name: w.name, type: w.type, working_now: w.active, unpaid_break_minutes: w.break_minutes,
          pay_rate: current ? Number(current.base_rate) : null, weekend_rate: current?.weekend_rate ?? null, overtime_rate: current?.overtime_rate ?? null,
        }
      })
    }

    case 'get_shifts': {
      let q = supabase.from('time_entry_costs').select('*').order('start_time', { ascending: true }).limit(400)
      if (input.worker_id) q = q.eq('worker_id', input.worker_id)
      if (input.job_id) q = q.eq('job_id', input.job_id)
      if (input.from) q = q.gte('start_time', dayStartIso(input.from) ?? input.from)
      if (input.to) q = q.lt('start_time', nextDayIso(input.to) ?? input.to)
      const [{ data }, { data: jobs }] = await Promise.all([q, supabase.from('jobs').select('id, code, address')])
      const jobById = new Map((jobs ?? []).map((j) => [j.id, j]))
      const rows = (data ?? []) as {
        id: string; worker_id: string; worker_name: string; worker_type: string; job_id: string; start_time: string; end_time: string | null
        work_day: string; paid_hours: number; overtime_hours: number; is_weekend: boolean; cost: number; needs_review: boolean
      }[]
      return {
        count: rows.length,
        total_paid_hours: r2(rows.reduce((s, e) => s + Number(e.paid_hours), 0)),
        total_labour_cost: r2(rows.reduce((s, e) => s + Number(e.cost), 0)),
        note: 'Subbie shifts show $0 cost: subbies are costed from their invoices.',
        shifts: rows.map((e) => ({
          id: e.id, worker: e.worker_name, worker_id: e.worker_id, worker_type: e.worker_type,
          job: site(jobById.get(e.job_id)), job_id: e.job_id, day: e.work_day,
          start: fmtClock(e.start_time), end: e.end_time ? fmtClock(e.end_time) : 'still on site',
          paid_hours: r2(Number(e.paid_hours)), overtime_hours: r2(Number(e.overtime_hours)), weekend: e.is_weekend,
          cost: r2(Number(e.cost)), needs_checking: e.needs_review,
        })),
      }
    }

    case 'get_invoices': {
      let q = supabase
        .from('expenses')
        .select('id, supplier, invoice_number, expense_date, amount_ex_gst, total, is_credit, category, status, hours, line_items, jobs(id, code, address)')
        .order('expense_date', { ascending: true })
        .limit(200)
      if (input.job_id) q = q.eq('job_id', input.job_id)
      if (input.supplier) q = q.ilike('supplier', `%${input.supplier}%`)
      if (input.from) q = q.gte('expense_date', input.from)
      if (input.to) q = q.lte('expense_date', input.to)
      if (input.status && input.status !== 'all') q = q.eq('status', input.status)
      else if (!input.status) q = q.neq('status', 'rejected')
      const { data } = await q
      const rows = (data ?? []) as unknown as {
        id: string; supplier: string | null; invoice_number: string | null; expense_date: string | null; amount_ex_gst: number; total: number
        is_credit: boolean; category: string; status: string; hours: number | null; line_items: unknown; jobs: { id: string; code: string; address: string | null } | null
      }[]
      return {
        count: rows.length,
        total_ex_gst: r2(rows.reduce((s, x) => s + Number(x.amount_ex_gst), 0)),
        invoices: rows.map((x) => ({
          id: x.id, supplier: x.supplier, number: x.invoice_number, date: x.expense_date, ex_gst: Number(x.amount_ex_gst),
          incl_gst: Number(x.total), credit: x.is_credit, type: x.category, status: x.status, subbie_hours: x.hours,
          job: x.jobs ? site(x.jobs) : 'not on a job', job_id: x.jobs?.id ?? null,
          items: itemsOf(x.line_items).map((i) => `${i.qty ?? 1} × ${i.description}${i.amount != null ? ` ($${i.amount})` : ''}`),
        })),
      }
    }

    case 'who_is_on_site': {
      const today = todaySydney()
      const [{ data: open }, { data: todays }, { data: workers }] = await Promise.all([
        supabase.from('time_entries').select('start_time, workers(name), jobs(code, address)').is('end_time', null),
        supabase.from('time_entries').select('worker_id').gte('start_time', dayStartIso(today) ?? today),
        supabase.from('workers').select('id, name, type').eq('active', true),
      ])
      const signed = new Set((todays ?? []).map((t) => t.worker_id))
      return {
        on_site_now: ((open ?? []) as unknown as { start_time: string; workers: { name: string } | null; jobs: { code: string; address: string | null } | null }[]).map(
          (e) => ({ name: e.workers?.name, job: site(e.jobs), since: fmtClock(e.start_time) }),
        ),
        not_signed_in_today: (workers ?? []).filter((w) => w.type !== 'subbie_fixed' && !signed.has(w.id)).map((w) => w.name),
      }
    }

    case 'propose_change_shift': {
      const { data: e } = await supabase
        .from('time_entries')
        .select('id, start_time, end_time, job_id, workers(name), jobs(code, address)')
        .eq('id', input.shift_id ?? '')
        .maybeSingle()
      if (!e) return { error: 'No shift with that id. Use get_shifts to find it.' }
      const t = readTimes(input.date ?? sydneyDateOf(e.start_time), input.start ?? '', input.end ?? null)
      if ('error' in t) return { error: t.error }
      let newJob = e.jobs as unknown as { code: string; address: string | null } | null
      if (input.job_id && input.job_id !== e.job_id) {
        const { data: j } = await supabase.from('jobs').select('code, address').eq('id', input.job_id).maybeSingle()
        if (!j) return { error: 'No job with that id.' }
        newJob = j
      }
      const name = (e.workers as unknown as { name: string } | null)?.name ?? 'Worker'
      const oldJob = e.jobs as unknown as { code: string; address: string | null } | null
      const moving = input.job_id && input.job_id !== e.job_id
      const summary =
        `Change ${name}'s shift on ${dayLabel(e.start_time)} at ${site(oldJob)}\n` +
        `from ${span(e.start_time, e.end_time)}\n` +
        `to ${moving ? `${site(newJob)}, ` : ''}${dayLabel(t.start!) !== dayLabel(e.start_time) ? `${dayLabel(t.start!)} ` : ''}${span(t.start!, t.end ?? null)}`
      proposals.push({ summary, token: seal({ kind: 'change_shift', shiftId: e.id, start: t.start!, end: t.end ?? null, jobId: input.job_id || e.job_id }) })
      return { shown_to_owner: summary, note: 'Not changed yet. The owner must press Confirm.' }
    }

    case 'propose_add_shift': {
      const [{ data: w }, { data: j }] = await Promise.all([
        supabase.from('workers').select('id, name').eq('id', input.worker_id ?? '').maybeSingle(),
        supabase.from('jobs').select('id, code, address').eq('id', input.job_id ?? '').maybeSingle(),
      ])
      if (!w) return { error: 'No worker with that id. Use list_workers.' }
      if (!j) return { error: 'No job with that id. Use list_jobs.' }
      const t = readTimes(input.date ?? '', input.start ?? '', input.end ?? '')
      if ('error' in t) return { error: t.error }
      const { data: overlap } = await supabase
        .from('time_entries')
        .select('start_time, end_time')
        .eq('worker_id', w.id)
        .lt('start_time', t.end!)
        .or(`end_time.is.null,end_time.gt."${t.start}"`)
      if (overlap?.length) return { error: `That overlaps a shift ${w.name} already has (${span(overlap[0].start_time, overlap[0].end_time)}). Change that shift instead.` }
      const summary = `Add hours for ${w.name} at ${site(j)}\non ${dayLabel(t.start!)}, ${span(t.start!, t.end!)}`
      proposals.push({ summary, token: seal({ kind: 'add_shift', workerId: w.id, jobId: j.id, start: t.start!, end: t.end! }) })
      return { shown_to_owner: summary, note: 'Not added yet. The owner must press Confirm.' }
    }

    case 'propose_move_invoice': {
      const { data: x } = await supabase
        .from('expenses')
        .select('id, supplier, amount_ex_gst, expense_date, job_id, jobs(code, address)')
        .eq('id', input.invoice_id ?? '')
        .maybeSingle()
      if (!x) return { error: 'No invoice with that id. Use get_invoices.' }
      let target: { code: string; address: string | null } | null = null
      if (input.job_id) {
        const { data: j } = await supabase.from('jobs').select('code, address').eq('id', input.job_id).maybeSingle()
        if (!j) return { error: 'No job with that id.' }
        target = j
      }
      const from = x.jobs as unknown as { code: string; address: string | null } | null
      const summary =
        `Move the ${x.supplier ?? 'unknown supplier'} invoice ($${Number(x.amount_ex_gst).toFixed(2)} ex GST, ${fmtDate(x.expense_date)})\n` +
        `from ${from ? site(from) : 'no job'}\nto ${target ? site(target) : 'no job (back to Needs checking)'}`
      proposals.push({ summary, token: seal({ kind: 'move_invoice', invoiceId: x.id, jobId: input.job_id ?? null }) })
      return { shown_to_owner: summary, note: 'Not moved yet. The owner must press Confirm.' }
    }
  }
  return { error: `Unknown tool ${name}` }
}

// ---------- Applying a confirmed change ----------

export async function applyChange(change: Change): Promise<string> {
  const supabase = createServiceClient()
  if (change.kind === 'change_shift') {
    const { error } = await supabase
      .from('time_entries')
      .update({ start_time: change.start, end_time: change.end, job_id: change.jobId, edited_by: 'owner', needs_review: false, review_reason: 'Changed by owner (via AI)' })
      .eq('id', change.shiftId)
    if (error) throw new Error(error.message)
    return 'Shift updated ✓'
  }
  if (change.kind === 'add_shift') {
    const { data: overlap } = await supabase
      .from('time_entries')
      .select('id')
      .eq('worker_id', change.workerId)
      .lt('start_time', change.end)
      .or(`end_time.is.null,end_time.gt."${change.start}"`)
    if (overlap?.length) return 'Already added (or it overlaps another shift), so nothing was changed.'
    const { error } = await supabase.from('time_entries').insert({
      worker_id: change.workerId, job_id: change.jobId, start_time: change.start, end_time: change.end,
      source: 'manual', edited_by: 'owner', review_reason: 'Added by owner (via AI)',
    })
    if (error) throw new Error(error.message)
    return 'Hours added ✓'
  }
  const { error } = await supabase
    .from('expenses')
    .update({ job_id: change.jobId, status: change.jobId ? 'approved' : 'pending' })
    .eq('id', change.invoiceId)
  if (error) throw new Error(error.message)
  return 'Invoice moved ✓'
}

// ---------- The conversation ----------

export type ChatMessage = { role: 'user' | 'assistant'; text: string }

function systemPrompt() {
  const today = todaySydney()
  const weekday = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'UTC' })
  return `You are the assistant inside BrushBooks, a job-profit app for a small painting business in NSW, Australia. You help the owner understand their jobs, hours and invoices, and make small fixes.
Today is ${weekday} ${today} (Sydney time). Times are Sydney time. Weeks run Monday to Sunday.

Rules:
- Use the tools to look things up. Never guess or invent numbers, names or dates. If the data doesn't have it, say so.
- Money is ex GST unless you say otherwise. Hours are paid hours (unpaid breaks taken off).
- Answer short and plain, like a helpful bookkeeper texting the owner. Australian English. Use numbers. Mention the dates or jobs your answer covers so the owner can check it. No markdown headings; short lists are fine.
- If a name or job is ambiguous (e.g. two people called Sam, or "the Dulux invoice" matches several), ask which one before doing anything.
- To change something, use a propose_ tool. It does NOT change anything: the owner sees a card and must press Confirm. Never say a change is done; say you've set it up for them to confirm.
- You can change shift times, move a shift to another job, add missed hours, and move an invoice to another job. You cannot delete anything, change pay rates, workers or job details: tell the owner where to do that in the app (Hours, Invoices, Workers pages, or the job's "Edit job details").
- Workers sign in and out on WhatsApp. Subbies are costed from their invoices, not their hours.`
}

export async function askAssistant(history: ChatMessage[]) {
  const supabase = createServiceClient()
  const proposals: Proposal[] = []
  const messages: Anthropic.Messages.MessageParam[] = history
    .filter((m) => m.text.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.text.slice(0, 4000) }))
  while (messages.length && messages[0].role !== 'user') messages.shift()
  if (!messages.length) return { text: 'Ask me anything about your jobs, hours or invoices.', proposals }

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await anthropic.messages.create({ model: MODEL, max_tokens: 2048, system: systemPrompt(), tools: TOOLS, messages })
    messages.push({ role: 'assistant', content: res.content })
    const calls = res.content.filter((c): c is Anthropic.Messages.ToolUseBlock => c.type === 'tool_use')
    if (res.stop_reason !== 'tool_use' || !calls.length) {
      const text = res.content.filter((c) => c.type === 'text').map((c) => (c as Anthropic.Messages.TextBlock).text).join('\n').trim()
      return { text: text || 'Done.', proposals }
    }
    const results: Anthropic.Messages.ToolResultBlockParam[] = []
    for (const call of calls) {
      let out: unknown
      try {
        out = await runTool(supabase, call.name, (call.input ?? {}) as Input, proposals)
      } catch (e) {
        out = { error: e instanceof Error ? e.message : 'Something went wrong' }
      }
      results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(out).slice(0, 60000) })
    }
    messages.push({ role: 'user', content: results })
  }
  return { text: "Sorry, that took too many steps. Try asking in a simpler way.", proposals }
}
