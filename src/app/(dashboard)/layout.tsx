import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth()
  if (!session) redirect('/login')

  return (
    <div className="min-h-screen bg-[#f6f7f9]">
      <Sidebar userName={session.name} />
      <Topbar userName={session.name} />
      <main className="ml-60 pt-14 min-h-screen">
        <div className="p-6">{children}</div>
      </main>
    </div>
  )
}
