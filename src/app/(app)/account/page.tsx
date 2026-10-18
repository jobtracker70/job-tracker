import { requireAuth } from '@/lib/auth'
import { cardClass } from '@/components/ui'
import { ChangePasswordForm } from './form'

export default async function AccountPage() {
  const session = await requireAuth()
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-[28px] md:text-[32px] font-bold leading-tight">My account</h1>
        <p className="text-muted mt-1">{session.name ? `${session.name} · ` : ''}{session.email} · {session.businessName}</p>
      </div>
      <section className={`${cardClass} p-5`}>
        <h2 className="text-lg font-bold mb-3">Change password</h2>
        <ChangePasswordForm />
      </section>
    </div>
  )
}
