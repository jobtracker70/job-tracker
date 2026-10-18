import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'

// Already logged in (e.g. opening the installed app)? Go straight to the jobs.
export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  if (await getSession()) redirect('/')
  return children
}
