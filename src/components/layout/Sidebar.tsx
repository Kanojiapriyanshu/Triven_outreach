'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  Megaphone,
  Mail,
  Upload,
  BarChart2,
  FileText,
  Settings,
  Zap,
  LogOut,
  Inbox,
} from 'lucide-react'
import useSWR from 'swr'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const navItems = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Inbox', href: '/inbox', icon: Inbox },
  { label: 'Campaigns', href: '/campaigns', icon: Megaphone },
  { label: 'Leads', href: '/leads', icon: Users },
  { label: "Today's Work", href: '/today', icon: CalendarCheck },
  { label: 'Templates', href: '/templates', icon: FileText },
  { label: 'Import', href: '/imports', icon: Upload },
  { label: 'Sender Accounts', href: '/sender-accounts', icon: Mail },
  { label: 'Analytics', href: '/analytics', icon: BarChart2 },
  { label: 'Settings', href: '/settings', icon: Settings },
]

async function handleLogout() {
  await fetch('/api/auth/logout', { method: 'POST' })
  window.location.href = '/login'
}

export default function Sidebar() {
  const pathname = usePathname()
  const { data: unreadData } = useSWR<{ unread: number }>('/api/inbox/unread', (u: string) => fetch(u).then((r) => r.json()), { refreshInterval: 60_000 })
  const unread = unreadData?.unread ?? 0

  return (
    <aside className="fixed left-0 top-0 h-screen w-60 bg-slate-900 flex flex-col z-40">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-slate-800">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
          <Zap className="h-4 w-4 text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white leading-none">Triven CRM</p>
          <p className="text-xs text-slate-500 mt-0.5">Outreach Platform</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(({ label, href, icon: Icon }) => {
          const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{label}</span>
              {href === '/inbox' && unread > 0 && (
                <span className="rounded-full bg-indigo-500 px-1.5 text-[10px] font-semibold leading-4 text-white">{unread > 99 ? '99+' : unread}</span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 pb-4 border-t border-slate-800 pt-3">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
