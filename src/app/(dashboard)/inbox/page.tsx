'use client'
import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { useSearchParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Inbox as InboxIcon, Search, Send, ExternalLink, CornerDownRight, Mail, CircleDot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/leads/StatusBadge'
import { fmtRelative, fmtDateTime } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface InboxRow { id: string; displayName: string; email: string; gmailStatus: string; unread: number; replies: number }
interface Conversation {
  id: string; companyName: string; fullName?: string | null; firstName?: string | null; companyEmail?: string | null
  status: string; hasReplied: boolean
  senderAccount?: { id: string; displayName: string; email: string } | null
  campaign?: { name: string } | null
  last: { direction: string; subject?: string | null; body?: string | null; createdAt: string } | null
  unread: number
}
interface Message {
  id: string; direction: 'OUTBOUND' | 'INBOUND'; subject?: string | null; body?: string | null
  fromAddress?: string | null; toAddress?: string | null; sentAt?: string | null; receivedAt?: string | null; createdAt: string
}
interface Thread {
  id: string; companyName: string; fullName?: string | null; companyEmail?: string | null; status: string
  senderAccount?: { id: string; displayName: string; email: string; gmailStatus: string } | null
  campaign?: { name: string } | null
  emailMessages: Message[]
  followUpTasks: Array<{ id: string; type: string; scheduledAt: string }>
}

const VIEWS = [
  { id: 'replies', label: 'Replies' },
  { id: 'unread', label: 'Unread' },
  { id: 'sent', label: 'Sent, no reply' },
  { id: 'all', label: 'All' },
]

const OUTCOMES = [
  { status: 'INTERESTED', label: 'Interested' },
  { status: 'MEETING_BOOKED', label: 'Meeting booked' },
  { status: 'NOT_INTERESTED', label: 'Not interested' },
  { status: 'DO_NOT_CONTACT', label: 'Do not contact' },
]

function InboxInner() {
  const router = useRouter()
  const params = useSearchParams()
  const inbox = params.get('inbox') || 'all'
  const view = params.get('view') || 'replies'
  const selected = params.get('lead')
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')

  const listKey = `/api/inbox?inbox=${inbox}&view=${view}${query ? `&q=${encodeURIComponent(query)}` : ''}`
  const { data, mutate: mutateList } = useSWR<{ conversations: Conversation[]; inboxes: InboxRow[] }>(listKey, fetcher, { refreshInterval: 60_000 })
  const { data: thread, mutate: mutateThread } = useSWR<Thread>(selected ? `/api/inbox/${selected}` : null, fetcher)

  // Pull new replies from Gmail when the Inbox opens and every 2 minutes while it stays open,
  // so replies show up right away instead of waiting for the background worker
  const [syncing, setSyncing] = useState(false)
  const { data: syncInfo, mutate: mutateSync } = useSWR<{ lastSyncAt: string | null }>('/api/inbox/sync', fetcher)
  async function syncNow(manual = false) {
    setSyncing(true)
    try {
      const res = await fetch('/api/inbox/sync', { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (manual && res.ok) {
        const found = (d.replies ?? 0) + (d.synced ?? 0)
        toast.success(d.skipped ? 'Just synced a moment ago' : found ? `${found} new message${found > 1 ? 's' : ''}` : 'Up to date')
      }
      mutateSync(); mutateList(); if (selected) mutateThread()
    } finally { setSyncing(false) }
  }
  useEffect(() => {
    syncNow()
    const t = setInterval(() => syncNow(), 120_000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const conversations = Array.isArray(data?.conversations) ? data.conversations : []
  const inboxes = Array.isArray(data?.inboxes) ? data.inboxes : []
  const totalUnread = inboxes.reduce((n, i) => n + i.unread, 0)

  function go(patch: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) (v ? p.set(k, v) : p.delete(k))
    router.push(`/inbox?${p.toString()}`)
  }

  // Opening a conversation marks it read: refresh counters
  useEffect(() => { if (thread) mutateList() }, [thread?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="-m-6 h-[calc(100vh-3.5rem)] flex bg-white">
      {/* Inboxes */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
        <div className="px-4 py-3 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Inboxes</p>
            <button onClick={() => syncNow(true)} disabled={syncing} className="text-xs text-indigo-600 hover:underline disabled:text-slate-400">
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
          <p className="text-xs text-slate-400">
            {syncing ? 'Checking Gmail…' : syncInfo?.lastSyncAt ? `Gmail checked ${fmtRelative(syncInfo.lastSyncAt)}` : 'Not synced yet'}
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <InboxButton active={inbox === 'all'} label="All inboxes" sub={`${inboxes.length} connected`} count={totalUnread} onClick={() => go({ inbox: null, lead: null })} />
          {inboxes.map((i) => (
            <InboxButton
              key={i.id}
              active={inbox === i.id}
              label={i.displayName}
              sub={i.email}
              count={i.unread}
              warn={i.gmailStatus !== 'CONNECTED'}
              onClick={() => go({ inbox: i.id, lead: null })}
            />
          ))}
        </nav>
      </aside>

      {/* Conversations */}
      <section className={`${selected ? 'hidden lg:flex' : 'flex'} w-full lg:w-96 shrink-0 flex-col border-r border-slate-200`}>
        <div className="p-3 border-b border-slate-200 space-y-2">
          <div className="md:hidden">
            <select
              value={inbox}
              onChange={(e) => go({ inbox: e.target.value === 'all' ? null : e.target.value, lead: null })}
              className="w-full h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm"
            >
              <option value="all">All inboxes</option>
              {inboxes.map((i) => <option key={i.id} value={i.id}>{i.displayName} ({i.email})</option>)}
            </select>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); setQuery(q) }} className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, practice, email"
              className="w-full h-9 pl-8 pr-3 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </form>
          <div className="flex gap-1">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => go({ view: v.id, lead: null })}
                className={`px-2.5 py-1 rounded-full text-xs font-medium ${view === v.id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {!data ? (
            <p className="p-6 text-sm text-slate-400">Loading…</p>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center">
              <InboxIcon className="h-10 w-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">{view === 'replies' ? 'No replies yet in this inbox.' : 'Nothing here yet.'}</p>
            </div>
          ) : conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => go({ lead: c.id })}
              className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${selected === c.id ? 'bg-indigo-50' : ''}`}
            >
              <div className="flex items-center gap-2">
                {c.unread > 0 && <span className="h-2 w-2 rounded-full bg-indigo-600 shrink-0" />}
                <p className={`text-sm truncate flex-1 ${c.unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                  {c.fullName || c.companyName}
                </p>
                {c.last && <span className="text-[11px] text-slate-400 shrink-0">{fmtRelative(c.last.createdAt)}</span>}
              </div>
              <p className="text-xs text-slate-500 truncate">{c.fullName ? c.companyName : c.companyEmail}</p>
              {c.last && (
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  {c.last.direction === 'OUTBOUND' && <CornerDownRight className="inline h-3 w-3 mr-0.5" />}
                  {(c.last.body || c.last.subject || '').replace(/\s+/g, ' ').slice(0, 120)}
                </p>
              )}
              <div className="flex items-center gap-1.5 mt-1.5">
                <StatusBadge status={c.status} className="text-[10px]" />
                {inbox === 'all' && c.senderAccount && <span className="text-[10px] text-slate-400 truncate">via {c.senderAccount.displayName}</span>}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Conversation */}
      <section className={`${selected ? 'flex' : 'hidden lg:flex'} flex-1 min-w-0 flex-col`}>
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400">Select a conversation</div>
        ) : !thread || !('emailMessages' in thread) ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400">Loading…</div>
        ) : (
          <ThreadView thread={thread} onBack={() => go({ lead: null })} onChanged={() => { mutateThread(); mutateList() }} />
        )}
      </section>
    </div>
  )
}

function InboxButton({ active, label, sub, count, warn, onClick }: {
  active: boolean; label: string; sub: string; count: number; warn?: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick} className={`w-full text-left rounded-lg px-3 py-2 ${active ? 'bg-white shadow-sm ring-1 ring-slate-200' : 'hover:bg-white/60'}`}>
      <div className="flex items-center gap-2">
        <Mail className={`h-3.5 w-3.5 shrink-0 ${warn ? 'text-red-500' : active ? 'text-indigo-600' : 'text-slate-400'}`} />
        <span className={`text-sm truncate flex-1 ${active ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{label}</span>
        {count > 0 && <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] font-semibold leading-4 text-white">{count}</span>}
      </div>
      <p className={`text-[11px] truncate pl-5 ${warn ? 'text-red-500' : 'text-slate-400'}`}>{warn ? 'Reconnect needed' : sub}</p>
    </button>
  )
}

function ThreadView({ thread, onBack, onChanged }: { thread: Thread; onBack: () => void; onChanged: () => void }) {
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const sender = thread.senderAccount

  useEffect(() => { endRef.current?.scrollIntoView() }, [thread.id, thread.emailMessages.length])

  async function sendReply() {
    if (!reply.trim()) return
    setSending(true)
    try {
      const res = await fetch(`/api/inbox/${thread.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: reply }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(d.error || 'Could not send')
      toast.success(`Sent from ${sender?.email}`)
      setReply('')
      onChanged()
    } finally { setSending(false) }
  }

  async function setOutcome(status: string) {
    await fetch(`/api/leads/${thread.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    toast.success(`Marked ${status.replace(/_/g, ' ').toLowerCase()}`)
    onChanged()
  }

  return (
    <>
      <header className="px-5 py-3 border-b border-slate-200 flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="lg:hidden text-sm text-indigo-600">← Back</button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900 truncate">{thread.fullName || thread.companyName}</h2>
            <StatusBadge status={thread.status} />
          </div>
          <p className="text-xs text-slate-500 truncate">
            {thread.fullName && <>{thread.companyName} · </>}{thread.companyEmail}
            {thread.campaign && <> · {thread.campaign.name}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {OUTCOMES.map((o) => (
            <Button key={o.status} size="sm" variant={thread.status === o.status ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setOutcome(o.status)}>
              {o.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" className="h-7 text-xs" asChild>
            <Link href={`/leads/${thread.id}`}><ExternalLink className="h-3 w-3" />Lead</Link>
          </Button>
        </div>
      </header>

      {thread.followUpTasks.length > 0 && (
        <div className="px-5 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-800 flex items-center gap-1.5">
          <CircleDot className="h-3 w-3" />
          {thread.followUpTasks.length} follow-up{thread.followUpTasks.length > 1 ? 's' : ''} still scheduled. They stop automatically if this lead replies.
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-slate-50/60">
        {thread.emailMessages.map((m) => {
          const ours = m.direction === 'OUTBOUND'
          return (
            <div key={m.id} className={`flex ${ours ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${ours ? 'bg-white border border-slate-200' : 'bg-teal-50 border border-teal-100'}`}>
                <div className="flex items-center gap-2 mb-1.5 text-[11px] text-slate-500">
                  <span className="font-medium text-slate-700">{ours ? `${sender?.displayName ?? 'You'} (${m.fromAddress ?? sender?.email})` : (m.fromAddress || thread.companyEmail)}</span>
                  <span>·</span>
                  <span>{fmtDateTime(m.sentAt || m.receivedAt || m.createdAt)}</span>
                </div>
                {m.subject && <p className="text-xs font-semibold text-slate-700 mb-1">{m.subject}</p>}
                <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{m.body || <span className="italic text-slate-400">(no text)</span>}</p>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      <footer className="border-t border-slate-200 p-3 bg-white">
        <div className="flex items-center gap-2 mb-2 text-xs text-slate-500">
          Replying from <Badge variant="secondary" className="text-xs">{sender ? `${sender.displayName} <${sender.email}>` : 'no inbox'}</Badge>
          in the same thread
        </div>
        <div className="flex gap-2 items-end">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendReply() }}
            placeholder={`Reply to ${thread.fullName || thread.companyName}…`}
            rows={3}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <Button onClick={sendReply} loading={sending} disabled={!reply.trim() || !sender || sender.gmailStatus !== 'CONNECTED'}>
            <Send className="h-4 w-4" />Send
          </Button>
        </div>
      </footer>
    </>
  )
}

export default function InboxPage() {
  return <Suspense fallback={<div className="p-8 text-sm text-slate-400">Loading…</div>}><InboxInner /></Suspense>
}
