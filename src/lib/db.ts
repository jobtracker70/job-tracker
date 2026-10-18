import { createServiceClient } from './supabase'
import { requireAuth, type Session } from './auth'

// Tables (and views) where every row belongs to one business
const BUSINESS_TABLES = new Set(['workers', 'jobs', 'time_entries', 'expenses', 'variations', 'job_summary', 'time_entry_costs'])

type Row = Record<string, unknown>

// Database access for ONE business. Every read, change and delete on a business table is limited to that
// business, and every new row is labelled with it, so one client can never see or touch another's data.
// Tables without a business (worker_rates, bot_state, app_settings…) go through `raw`, and the caller must
// first check the worker/job they belong to is this business's.
export function businessDb(businessId: string) {
  const raw = createServiceClient()
  const stamp = (values: Row | Row[]) =>
    Array.isArray(values) ? values.map((v) => ({ ...v, business_id: businessId })) : { ...values, business_id: businessId }

  function from(table: string) {
    if (!BUSINESS_TABLES.has(table)) throw new Error(`"${table}" isn't a business table: use db.raw and check ownership`)
    const q = raw.from(table)
    return {
      // Rows come back loosely typed; pages describe the shape they expect
      select: (columns = '*', options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) =>
        q.select(columns as '*', options).eq('business_id', businessId),
      insert: (values: Row | Row[]) => q.insert(stamp(values)),
      update: (values: Row) => q.update({ ...values, business_id: businessId }).eq('business_id', businessId),
      delete: () => q.delete().eq('business_id', businessId),
    }
  }

  // True if the row with this id exists in this business (use before trusting an id that came from a form)
  async function owns(table: string, id: string | null | undefined) {
    if (!id) return false
    const { data } = await from(table).select('id').eq('id', id).maybeSingle()
    return !!data
  }

  return { businessId, from, owns, raw, storage: raw.storage }
}

export type BusinessDb = ReturnType<typeof businessDb>

// For pages and actions: the logged-in person's business
export async function getDb(): Promise<{ db: BusinessDb; session: Session }> {
  const session = await requireAuth()
  return { db: businessDb(session.businessId), session }
}
