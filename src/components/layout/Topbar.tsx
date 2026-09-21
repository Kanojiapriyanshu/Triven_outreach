'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { Search, Bell, User, MessageSquare, AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { fmtRelative } from '@/lib/utils'

interface TopbarProps {
  title?: string
  userName?: string
}

interface Notification {
  id: string; type: string; title: string; body?: string | null
  isRead: boolean; leadId?: string | null; createdAt: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function Topbar({ title, userName }: TopbarProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const panelRef = useRef<HTMLDivElement>(null)
  const { data, mutate } = useSWR<{ items: Notification[]; unread: number }>('/api/notifications', fetcher, { refreshInterval: 60_000 })
  const items = Array.isArray(data?.items) ? data.items : []
  const unread = data?.unread ?? 0

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!panelRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && unread > 0) {
      await fetch('/api/notifications', { method: 'POST' })
      mutate()
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (query.trim()) {
      router.push(`/leads?q=${encodeURIComponent(query.trim())}`)
    }
  }

  return (
    <header className="fixed top-0 right-0 left-60 z-30 h-14 border-b border-slate-200 bg-white/90 backdrop-blur-sm flex items-center px-6 gap-4">
      {title && (
        <h1 className="text-base font-semibold text-slate-900 mr-4 shrink-0">{title}</h1>
      )}

      {/* Search */}
      <form onSubmit={handleSearch} className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search leads, companies, emails…"
            className="w-full h-8 pl-9 pr-4 rounded-lg border border-slate-200 bg-slate-50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
      </form>

      <div className="flex items-center gap-2 ml-auto">
        {/* Notifications */}
        <div className="relative" ref={panelRef}>
          <button
            onClick={toggle}
            className="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            aria-label={`Notifications${unread ? ` (${unread} new)` : ''}`}
          >
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-[10px] font-semibold leading-4 text-white text-center">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
          {open && (
            <div className="absolute right-0 top-11 w-80 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-100 text-sm font-semibold text-slate-800">Notifications</div>
              <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                {items.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-slate-400">Nothing yet. Replies and account alerts show up here.</p>
                ) : items.map((n) => {
                  const Icon = n.type === 'REPLY' ? MessageSquare : AlertTriangle
                  const href = n.leadId ? `/leads/${n.leadId}` : n.type === 'GMAIL_ERROR' ? '/sender-accounts' : undefined
                  const content = (
                    <div className={`flex gap-3 px-4 py-3 hover:bg-slate-50 ${n.isRead ? '' : 'bg-indigo-50/40'}`}>
                      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${n.type === 'REPLY' ? 'text-teal-600' : 'text-amber-600'}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{n.title}</p>
                        {n.body && <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">{n.body}</p>}
                        <p className="text-[11px] text-slate-400 mt-1">{fmtRelative(n.createdAt)}</p>
                      </div>
                    </div>
                  )
                  return href
                    ? <Link key={n.id} href={href} onClick={() => setOpen(false)} className="block">{content}</Link>
                    : <div key={n.id}>{content}</div>
                })}
              </div>
            </div>
          )}
        </div>

        {/* User */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-white text-xs font-semibold">
            {userName ? userName[0].toUpperCase() : <User className="h-4 w-4" />}
          </div>
          {userName && <span className="text-sm font-medium text-slate-700">{userName}</span>}
        </div>
      </div>
    </header>
  )
}
