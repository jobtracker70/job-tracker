import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { Pill, cardClass, inputClass, secondaryButtonClass } from '@/components/ui'
import { ConfirmButton } from '@/components/confirm-button'
import { renameBusiness, setLoginActive, viewBusiness } from './actions'
import { AddPersonForm, NewClientForm, ResetPasswordButton } from './forms'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type User = { id: string; email: string; name: string | null; role: string; is_admin: boolean; active: boolean; last_login_at: string | null }
type Business = { id: string; name: string; created_at: string; app_users: User[] }

export default async function AdminPage() {
  const session = await requireAdmin()
  const sb = createServiceClient()
  const [{ data }, { data: jobs }, { data: workers }] = await Promise.all([
    sb.from('businesses').select('id, name, created_at, app_users(id, email, name, role, is_admin, active, last_login_at)').order('created_at'),
    sb.from('jobs').select('business_id'),
    sb.from('workers').select('business_id').eq('active', true),
  ])
  const businesses = (data ?? []) as Business[]
  const count = (rows: { business_id: string }[] | null, id: string) => (rows ?? []).filter((r) => r.business_id === id).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] md:text-[32px] font-bold leading-tight">Admin</h1>
        <p className="text-muted mt-1">Only you see this page. Create client accounts and manage their logins.</p>
      </div>

      <section className={`${cardClass} p-5`}>
        <h2 className="text-lg font-bold mb-3">Add a client</h2>
        <NewClientForm />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Businesses <span className="text-muted font-normal">({businesses.length})</span></h2>
        {businesses.map((b) => (
          <details key={b.id} className={`${cardClass} group`} open={businesses.length <= 3}>
            <summary className="flex items-center justify-between gap-3 px-5 py-4 cursor-pointer">
              <span className="min-w-0">
                <span className="font-bold text-[17px]">{b.name}</span>
                {b.id === session.businessId && <span className="ml-2"><Pill tone="brand">viewing now</Pill></span>}
                <span className="block text-sm text-muted">
                  {count(jobs, b.id)} jobs · {count(workers, b.id)} workers · {b.app_users.length} login{b.app_users.length === 1 ? '' : 's'} · since {fmtDate(b.created_at)}
                </span>
              </span>
              <span className="text-faint text-xl transition group-open:rotate-90">›</span>
            </summary>
            <div className="px-5 pb-5 space-y-4">
              <div className="flex flex-wrap gap-2">
                {b.id !== session.businessId && (
                  <form action={viewBusiness.bind(null, b.id)}><button className={secondaryButtonClass}>Open their account</button></form>
                )}
                <form action={renameBusiness.bind(null, b.id)} className="flex gap-2">
                  <input name="name" defaultValue={b.name} className={`${inputClass} !py-2 !w-56`} />
                  <button className={secondaryButtonClass}>Rename</button>
                </form>
              </div>

              <ul className="divide-y divide-line border border-line rounded-xl">
                {b.app_users.map((u) => (
                  <li key={u.id} className={`px-3 py-2.5 text-sm flex flex-wrap items-center justify-between gap-2 ${u.active ? '' : 'opacity-50'}`}>
                    <span className="min-w-0">
                      <span className="font-semibold">{u.name ?? u.email}</span>
                      <span className="text-muted"> · {u.email} · {u.is_admin ? 'admin' : u.role}</span>
                      <span className="block text-xs text-faint">{u.last_login_at ? `Last logged in ${fmtDateTime(u.last_login_at)}` : 'Never logged in'}</span>
                    </span>
                    {u.id !== session.userId && (
                      <span className="flex items-center gap-3">
                        <ResetPasswordButton userId={u.id} email={u.email} />
                        <form action={setLoginActive.bind(null, u.id, !u.active)}>
                          {u.active ? (
                            <ConfirmButton label="Turn off" question={`Turn off ${u.email}'s login? They won't be able to log in until you turn it back on.`} confirmLabel="Yes, turn off" className="text-bad text-sm font-semibold" />
                          ) : (
                            <button className="text-brand text-sm font-semibold">Turn on</button>
                          )}
                        </form>
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              <details>
                <summary className="text-brand text-sm font-semibold cursor-pointer">+ Add another login for {b.name}</summary>
                <div className="mt-3"><AddPersonForm businessId={b.id} /></div>
              </details>
            </div>
          </details>
        ))}
      </section>
    </div>
  )
}
