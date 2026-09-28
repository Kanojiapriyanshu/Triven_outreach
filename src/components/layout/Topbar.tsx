'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { toast } from 'sonner'
import {
  Search, Bell, BellRing, User, MessageSquare, AlertTriangle, CheckCheck, MapPinned, Sparkles, Megaphone, Gauge, MailX, Coins,
  Users, Building2, UserSearch, type LucideIcon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { fmtRelative } from '@/lib/utils'

interface Notification {
  id: string; type: string; title: string; body?: string | null
  isRead: boolean; leadId?: string | null; href?: string | null; createdAt: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const KIND: Record<string, { icon: LucideIcon; color: string }> = {
  REPLY: { icon: MessageSquare, color: 'text-teal-600 bg-teal-50' },
  LEADS_READY: { icon: Sparkles, color: 'text-emerald-600 bg-emerald-50' },
  SEARCH_DONE: { icon: MapPinned, color: 'text-indigo-600 bg-indigo-50' },
  CAMPAIGN_EMPTY: { icon: Megaphone, color: 'text-amber-600 bg-amber-50' },
  QUOTA: { icon: Gauge, color: 'text-amber-600 bg-amber-50' },
  CREDITS_LOW: { icon: Coins, color: 'text-amber-600 bg-amber-50' },
  BOUNCE: { icon: MailX, color: 'text-red-600 bg-red-50' },
  GMAIL_ERROR: { icon: AlertTriangle, color: 'text-red-600 bg-red-50' },
}

const DESKTOP_KEY = 'triven:desktop-alerts'

function readDesktopPref() {
  try { return localStorage.getItem(DESKTOP_KEY) === '1' } catch { return false }
}

export default function Topbar({ userName }: { title?: string; userName?: string }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const [desktop, setDesktop] = useState(false)
  const router = useRouter()
  const panelRef = useRef<HTMLDivElement>(null)
  const seen = useRef<Set<string> | null>(null)
  const { data, mutate } = useSWR<{ items: Notification[]; unread: number }>('/api/notifications', fetcher, { refreshInterval: 30_000 })
  const items = Array.isArray(data?.items) ? data.items : []
  const unread = data?.unread ?? 0
  const shown = tab === 'unread' ? items.filter((n) => !n.isRead) : items

  useEffect(() => { setDesktop(readDesktopPref() && typeof Notification !== 'undefined' && Notification.permission === 'granted') }, [])

  // New alerts since the page loaded: a toast, and a desktop notification when the tab is in the background
  useEffect(() => {
    if (!data?.items) return
    if (!seen.current) { seen.current = new Set(data.items.map((n) => n.id)); return }
    const fresh = data.items.filter((n) => !n.isRead && !seen.current!.has(n.id))
    for (const n of fresh.slice(0, 3)) {
      seen.current.add(n.id)
      toast(n.title, { description: n.body || undefined, action: n.href ? { label: 'Open', onClick: () => router.push(n.href!) } : undefined })
      if (desktop && document.hidden && typeof Notification !== 'undefined') {
        const d = new Notification(n.title, { body: n.body || '', icon: '/brand/triven-mark.png', tag: n.id })
        d.onclick = () => { window.focus(); if (n.href) router.push(n.href) }
      }
    }
  }, [data, desktop, router])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!panelRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  useEffect(() => {
    const title = document.title.replace(/^\(\d+\)\s*/, '')
    document.title = unread ? `(${unread}) ${title}` : title
  }, [unread])

  async function markRead(id?: string) {
    await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(id ? { id } : {}) })
    mutate()
  }

  async function toggleDesktop() {
    if (desktop) {
      try { localStorage.setItem(DESKTOP_KEY, '0') } catch { /* private mode */ }
      setDesktop(false)
      return
    }
    if (typeof Notification === 'undefined') return toast.error('This browser does not support desktop notifications')
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return toast.error('Allow notifications for this site in your browser to turn this on')
    try { localStorage.setItem(DESKTOP_KEY, '1') } catch { /* private mode */ }
    setDesktop(true)
    toast.success('Desktop alerts on: replies and ready leads pop up even when this tab is in the background')
  }

  return (
    <header className="fixed top-0 right-0 left-60 z-30 h-14 border-b border-slate-200 bg-white/90 backdrop-blur-sm flex items-center px-6 gap-4">
      <GlobalSearch />

      <div className="flex items-center gap-2 ml-auto">
        <div className="relative" ref={panelRef}>
          <button
            onClick={() => setOpen((v) => !v)}
            className="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            aria-label={`Notifications${unread ? ` (${unread} new)` : ''}`}
          >
            {unread ? <BellRing className="h-5 w-5 text-slate-700" /> : <Bell className="h-5 w-5" />}
            {unread > 0 && (
              <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-[10px] font-semibold leading-4 text-white text-center">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
          {open && (
            <div className="absolute right-0 top-11 w-[380px] rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                <p className="text-sm font-semibold text-slate-800">Notifications</p>
                <div className="flex items-center gap-1">
                  {(['all', 'unread'] as const).map((t) => (
                    <button key={t} onClick={() => setTab(t)} className={`rounded-md px-2 py-0.5 text-xs ${tab === t ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
                      {t === 'all' ? 'All' : `Unread${unread ? ` (${unread})` : ''}`}
                    </button>
                  ))}
                  {unread > 0 && (
                    <button onClick={() => markRead()} title="Mark all as read" className="ml-1 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><CheckCheck className="h-4 w-4" /></button>
                  )}
                </div>
              </div>
              <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
                {shown.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-slate-400">{tab === 'unread' ? 'All caught up.' : 'Nothing yet. Replies, ready leads and account alerts show up here.'}</p>
                ) : shown.map((n) => {
                  const k = KIND[n.type] || { icon: AlertTriangle, color: 'text-slate-500 bg-slate-100' }
                  const content = (
                    <div className={`flex gap-3 px-4 py-3 hover:bg-slate-50 ${n.isRead ? '' : 'bg-indigo-50/30'}`}>
                      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${k.color}`}><k.icon className="h-3.5 w-3.5" /></span>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm ${n.isRead ? 'text-slate-700' : 'font-medium text-slate-900'}`}>{n.title}</p>
                        {n.body && <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">{n.body}</p>}
                        <p className="text-[11px] text-slate-400 mt-1">{fmtRelative(n.createdAt)}</p>
                      </div>
                      {!n.isRead && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-indigo-500" />}
                    </div>
                  )
                  return n.href
                    ? <Link key={n.id} href={n.href} onClick={() => { setOpen(false); if (!n.isRead) markRead(n.id) }} className="block">{content}</Link>
                    : <button key={n.id} onClick={() => !n.isRead && markRead(n.id)} className="block w-full text-left">{content}</button>
                })}
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2">
                <button onClick={toggleDesktop} className="text-xs text-slate-500 hover:text-slate-800">
                  Desktop alerts: <span className={desktop ? 'font-medium text-emerald-600' : 'text-slate-400'}>{desktop ? 'on' : 'off'}</span>
                </button>
                {items.some((n) => n.isRead) && (
                  <button onClick={async () => { await fetch('/api/notifications', { method: 'DELETE' }); mutate() }} className="text-xs text-slate-400 hover:text-slate-700">Clear read</button>
                )}
              </div>
            </div>
          )}
        </div>

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

interface SearchResults {
  leads: Array<{ id: string; companyName: string; fullName: string | null; companyEmail: string | null; status: string }>
  businesses: Array<{ id: string; name: string; city: string | null; state: string | null; status: string }>
  prospects: Array<{ id: string; displayName: string; company: string | null; status: string }>
}

/** One box for everything: leads, Lead Finder businesses and audience prospects (Ctrl/⌘ K) */
function GlobalSearch() {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const { data } = useSWR<SearchResults>(debounced.length >= 2 ? `/api/search?q=${encodeURIComponent(debounced)}` : null, fetcher)

  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t) }, [q])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const go = (href: string) => { setQ(''); setFocused(false); inputRef.current?.blur(); router.push(href) }
  const total = (data?.leads.length || 0) + (data?.businesses.length || 0) + (data?.prospects.length || 0)

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) go(`/leads?q=${encodeURIComponent(q.trim())}`) }} className="relative flex-1 max-w-md">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="Search leads, businesses, prospects…"
        className="w-full h-8 pl-9 pr-14 rounded-lg border border-slate-200 bg-slate-50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 text-[10px] text-slate-400">Ctrl K</kbd>
      {focused && debounced.length >= 2 && data && (
        <div className="absolute left-0 right-0 top-10 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
          {total === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-400">No matches</p> : (
            <div className="max-h-96 overflow-y-auto py-1">
              {data.leads.length > 0 && <Group label="Leads" icon={Users}>{data.leads.map((l) => (
                <Hit key={l.id} onClick={() => go(`/leads/${l.id}`)} title={l.fullName ? `${l.fullName} · ${l.companyName}` : l.companyName} sub={l.companyEmail || l.status.toLowerCase().replace(/_/g, ' ')} />
              ))}</Group>}
              {data.businesses.length > 0 && <Group label="Lead Finder" icon={Building2}>{data.businesses.map((b) => (
                <Hit key={b.id} onClick={() => go(`/finder?q=${encodeURIComponent(b.name)}`)} title={b.name} sub={[b.city, b.state].filter(Boolean).join(', ')} />
              ))}</Group>}
              {data.prospects.length > 0 && <Group label="Audience" icon={UserSearch}>{data.prospects.map((p) => (
                <Hit key={p.id} onClick={() => go(`/audience/prospects?q=${encodeURIComponent(p.displayName)}`)} title={p.displayName} sub={p.company || p.status.toLowerCase().replace(/_/g, ' ')} />
              ))}</Group>}
            </div>
          )}
        </div>
      )}
    </form>
  )
}

function Group({ label, icon: Icon, children }: { label: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <p className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400"><Icon className="h-3 w-3" />{label}</p>
      {children}
    </div>
  )
}

function Hit({ title, sub, onClick }: { title: string; sub?: string; onClick: () => void }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} className="block w-full px-3 py-1.5 text-left hover:bg-slate-50">
      <p className="truncate text-sm text-slate-800">{title}</p>
      {sub && <p className="truncate text-[11px] text-slate-400">{sub}</p>}
    </button>
  )
}
