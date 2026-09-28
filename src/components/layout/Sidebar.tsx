'use client'
import Image from 'next/image'
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
  LogOut,
  Inbox,
  Radar,
  Telescope,
  UserSearch,
  MapPinned,
  Activity,
  Layers,
  BarChart3,
  Kanban,
  UserCog,
  type LucideIcon,
} from 'lucide-react'
import useSWR from 'swr'
import { cn } from '@/lib/utils'

interface NavItem { label: string; href: string; icon: LucideIcon; exact?: boolean; badge?: 'unread' | 'finderReady' | 'prospectsReady' }

const sections: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Workspace',
    items: [
      { label: 'Dashboard', href: '/', icon: LayoutDashboard, exact: true },
      { label: 'Inbox', href: '/inbox', icon: Inbox, badge: 'unread' },
      { label: "Today's work", href: '/today', icon: CalendarCheck },
      { label: 'Analytics', href: '/analytics', icon: BarChart2 },
    ],
  },
  {
    title: 'Prospecting',
    items: [
      { label: 'Lead Finder', href: '/finder', icon: MapPinned, badge: 'finderReady' },
      { label: 'Audience', href: '/audience', icon: Radar, exact: true },
      { label: 'Discover', href: '/audience/discover', icon: Telescope },
      { label: 'Prospects', href: '/audience/prospects', icon: UserSearch, badge: 'prospectsReady' },
      { label: 'Segments', href: '/audience/segments', icon: Layers },
      { label: 'Sources', href: '/audience/sources', icon: BarChart3 },
    ],
  },
  {
    title: 'Outreach',
    items: [
      { label: 'Campaigns', href: '/campaigns', icon: Megaphone },
      { label: 'Leads', href: '/leads', icon: Users },
      { label: 'Pipeline', href: '/pipeline', icon: Kanban },
      { label: 'Templates', href: '/templates', icon: FileText },
      { label: 'Import', href: '/imports', icon: Upload },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { label: 'Sender accounts', href: '/sender-accounts', icon: Mail },
      { label: 'Team', href: '/users', icon: UserCog },
      { label: 'System health', href: '/system', icon: Activity },
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
]

async function handleLogout() {
  await fetch('/api/auth/logout', { method: 'POST' })
  window.location.href = '/login'
}

export default function Sidebar({ userName }: { userName?: string }) {
  const pathname = usePathname()
  const { data: counts } = useSWR<{ unread: number; finderReady: number; prospectsReady: number }>('/api/nav', (u: string) => fetch(u).then((r) => r.json()), { refreshInterval: 60_000 })
  const initials = (userName || 'T').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-60 flex-col bg-ink text-slate-300">
      {/* Brand */}
      <div className="flex h-14 items-center gap-2.5 px-5 border-b border-white/[0.06]">
        <Image src="/brand/triven-mark.png" alt="" width={28} height={28} priority className="h-7 w-7" />
        <div className="leading-tight">
          <p className="text-[15px] font-semibold tracking-tight text-white">Triven</p>
          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Growth suite</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{section.title}</p>
            <div className="space-y-0.5">
              {section.items.map(({ label, href, icon: Icon, exact, badge }) => {
                const count = badge ? counts?.[badge] ?? 0 : 0
                const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-md px-3 py-1.5 text-[13px] transition-colors',
                      isActive ? 'bg-white/[0.07] text-white font-medium' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100',
                    )}
                  >
                    {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-brand-gold" />}
                    <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-brand-gold' : 'text-slate-500 group-hover:text-slate-300')} />
                    <span className="flex-1">{label}</span>
                    {count > 0 && (
                      <span title={badge === 'unread' ? 'Unread replies' : 'Ready to add to a campaign'}
                        className={cn('rounded-full px-1.5 text-[10px] font-semibold leading-4', badge === 'unread' ? 'bg-brand-gold text-ink' : 'bg-white/10 text-slate-200')}>
                        {count > 999 ? '999+' : count}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Account */}
      <div className="border-t border-white/[0.06] p-3">
        <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-yellow to-indigo-500 text-[11px] font-semibold text-ink">{initials}</span>
          <span className="flex-1 truncate text-[13px] text-slate-200">{userName || 'Account'}</span>
          <button onClick={handleLogout} title="Sign out" className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}
