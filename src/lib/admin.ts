import { randomInt } from 'node:crypto'
import { createServiceClient } from './supabase'
import { hashPassword } from './auth'

export const FIRST_BUSINESS_ID = '00000000-0000-0000-0000-000000000001'

const WORDS = ['brush', 'roller', 'primer', 'gloss', 'satin', 'ladder', 'drop', 'sheet', 'coat', 'trim', 'putty', 'sand']
// Easy to read out over the phone, e.g. "satin-4821-roller"
export const tempPassword = () => `${WORDS[randomInt(WORDS.length)]}-${randomInt(1000, 10000)}-${WORDS[randomInt(WORDS.length)]}`

export const cleanEmail = (s: string) => s.trim().toLowerCase()

export async function addLogin(businessId: string, email: string, name: string | null, role: 'owner' | 'staff' = 'owner') {
  const password = tempPassword()
  const { error } = await createServiceClient()
    .from('app_users')
    .insert({ business_id: businessId, email: cleanEmail(email), name, role, password_hash: hashPassword(password) })
  if (error) throw new Error(error.code === '23505' ? 'That email already has a login.' : error.message)
  return password
}

export async function resetPassword(userId: string) {
  const password = tempPassword()
  const { error } = await createServiceClient().from('app_users').update({ password_hash: hashPassword(password) }).eq('id', userId)
  if (error) throw new Error(error.message)
  return password
}

// Copies the sample jobs (codes starting DEMO-), their pretend workers, hours, invoices and extras into a
// business, so a new client has something to look around before adding their own.
export async function copySampleData(targetBusinessId: string) {
  const sb = createServiceClient()
  const src = FIRST_BUSINESS_ID
  const [{ data: jobs }, { data: workers }] = await Promise.all([
    sb.from('jobs').select('*').eq('business_id', src).like('code', 'DEMO-%'),
    sb.from('workers').select('*, worker_rates(*)').eq('business_id', src).like('phone', '+61000000%'),
  ])
  if (!jobs?.length) return { jobs: 0 }
  const jobIds = jobs.map((j) => j.id)

  // Workers get new pretend numbers (+6100…): real WhatsApp numbers can only belong to one worker
  const workerMap = new Map<string, string>()
  for (const w of workers ?? []) {
    const { id, worker_rates: rates, created_at: _c, business_id: _b, ...rest } = w
    void _c; void _b
    let inserted = null
    for (let tries = 0; tries < 5 && !inserted; tries++) {
      const { data } = await sb
        .from('workers')
        .insert({ ...rest, business_id: targetBusinessId, phone: `+6100${randomInt(1000000, 9999999)}` })
        .select('id')
        .single()
      inserted = data
    }
    if (!inserted) continue
    workerMap.set(id, inserted.id)
    const copies = (rates ?? []).map(({ id: _id, worker_id: _w, created_at: _rc, ...r }: Record<string, unknown>) => {
      void _id; void _w; void _rc
      return { ...r, worker_id: inserted.id }
    })
    if (copies.length) await sb.from('worker_rates').insert(copies)
  }

  const jobMap = new Map<string, string>()
  for (const j of jobs) {
    const { id, created_at: _c, business_id: _b, ...rest } = j
    void _c; void _b
    const { data } = await sb.from('jobs').insert({ ...rest, business_id: targetBusinessId, quote_pdf_path: null }).select('id').single()
    if (data) jobMap.set(id, data.id)
  }

  const [{ data: entries }, { data: expenses }, { data: variations }] = await Promise.all([
    sb.from('time_entries').select('*').in('job_id', jobIds),
    sb.from('expenses').select('*').in('job_id', jobIds),
    sb.from('variations').select('*').in('job_id', jobIds),
  ])
  const strip = ({ id: _i, created_at: _c, ...r }: Record<string, unknown>) => {
    void _i; void _c
    return r
  }

  const newEntries = (entries ?? [])
    .filter((e) => workerMap.has(e.worker_id) && jobMap.has(e.job_id))
    .map((e) => ({ ...strip(e), business_id: targetBusinessId, worker_id: workerMap.get(e.worker_id), job_id: jobMap.get(e.job_id) }))
  if (newEntries.length) await sb.from('time_entries').insert(newEntries)

  const newExpenses = (expenses ?? []).map((x) => {
    const r = strip(x)
    delete r.amount_ex_gst // worked out by the database
    return {
      ...r,
      business_id: targetBusinessId,
      job_id: jobMap.get(x.job_id) ?? null,
      worker_id: x.worker_id ? workerMap.get(x.worker_id) ?? null : null,
      submitted_by: x.submitted_by ? workerMap.get(x.submitted_by) ?? null : null,
      image_path: null,
      email_message_id: null,
    }
  })
  if (newExpenses.length) await sb.from('expenses').insert(newExpenses)

  const newVariations = (variations ?? []).map((v) => ({ ...strip(v), business_id: targetBusinessId, job_id: jobMap.get(v.job_id) }))
  if (newVariations.length) await sb.from('variations').insert(newVariations)

  return { jobs: jobMap.size, workers: workerMap.size, shifts: newEntries.length, invoices: newExpenses.length }
}
