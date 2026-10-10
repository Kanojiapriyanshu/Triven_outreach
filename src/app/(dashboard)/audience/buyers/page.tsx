'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { toast } from 'sonner'
import { PhoneMissed, Search, Play, ExternalLink, Copy, Check, MessageSquareReply, Building2, SkipForward, Undo2, CircleAlert, ListVideo } from 'lucide-react'
import PageHeader from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { BUYER_SEARCHES, BUYER_SIGNAL_LABEL, REPLY_RULES, isHighSignal, isNegativeSignal } from '@/lib/audience/buyer-rules'
import { nicheOf } from '@/lib/finder/niches'
import { fmtRelative } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(async (r) => {
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'Request failed')
  return d
})

interface Row {
  id: string; displayName: string; handle: string | null; country: string | null; location: string | null
  businessName: string | null; website: string | null; trade: string | null; score: number; tier: 'A' | 'B' | 'C'
  signals: string[]; evidence: string[]; commentCount: number; bestCommentText: string | null; lastCommentAt: string | null
  checkedAt: string | null; businessId: string | null; replyStatus: 'NONE' | 'TODO' | 'SENT' | 'RESPONDED' | 'SKIPPED'; replySentAt: string | null; nextStep: string | null
  commentUrl: string | null; videoTitle: string | null; channelUrl: string; suggestedReply: string
  business: { id: string; name: string; status: string; fitScore: number; email: string | null } | null
}
interface Video {
  id: string; youtubeVideoId: string; title: string; status: string; score: number; scoreReasons: string | null
  viewCount: number; commentCount: number; commentsCollected: number; publishedAt: string | null; lastError: string | null
  channel: { title: string }; yield?: { a: number; b: number; sent: number; responded: number }
}
interface Overview {
  rows: Row[]; videos: Video[]; youtube: boolean
  counts: { a: number; b: number; c: number; toReply: number; replied: number; responded: number; inLeadFinder: number; newThisWeek: number; repliesToday: number }
}

const DAILY_REPLY_LIMIT = 15
const BIZ_STATUS: Record<string, string> = {
  NEW: 'Finding their contact…', RESEARCHING: 'Finding their contact…', READY: 'Email ready: add to a campaign', EMAIL_FOUND: 'Email found, being checked',
  NO_EMAIL: 'No email: call or use their contact form', IN_CAMPAIGN: 'In a campaign', EXCLUDED: 'Excluded', DO_NOT_CONTACT: 'Do not contact',
}

export default function BuyersPage() {
  const { data, mutate, error } = useSWR<Overview>('/api/audience/buyers', fetcher, { refreshInterval: 60_000 })
  const [tab, setTab] = useState<'A' | 'REPLY' | 'VIDEOS'>('REPLY')
  const [busy, setBusy] = useState('')

  async function post(body: Record<string, unknown>, key = '') {
    setBusy(key || String(body.action))
    try {
      const res = await fetch('/api/audience/buyers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error || 'Something went wrong'); return null }
      return d
    } finally { setBusy('') }
  }

  /** Read queued videos, check channels and sort people into tiers; repeats until nothing is waiting */
  async function run() {
    setBusy('run')
    try {
      let comments = 0, people = 0
      for (let i = 0; i < 6; i++) {
        const res = await fetch('/api/audience/buyers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'run' }) })
        const d = await res.json().catch(() => ({}))
        if (!res.ok) { toast.error(d.error || 'Run failed'); break }
        comments += d.collect?.newComments || 0
        people += d.collect?.newProspects || 0
        if (d.collect?.errors?.length) { toast.error(d.collect.errors[0]); break }
        await mutate()
        if (!d.waiting) break
      }
      toast.success(`Read ${comments.toLocaleString('en-US')} new comments: ${people} ${people === 1 ? 'person' : 'people'} worth a look`)
    } finally { setBusy('') }
  }

  const rows = data?.rows || []
  const tierA = rows.filter((r) => r.tier === 'A')
  const replyList = rows.filter((r) => ['TODO', 'SENT', 'RESPONDED'].includes(r.replyStatus))
  const c = data?.counts
  const queued = (data?.videos || []).filter((v) => v.status === 'QUEUED' || v.status === 'COLLECTING').length

  return (
    <div className="space-y-5 max-w-6xl">
      <PageHeader section="Prospecting" title="Receptionist buyers" icon={PhoneMissed}
        description="Business owners who say, under YouTube videos, that they miss calls. People who clearly run a business go to the Lead Finder to be emailed; the rest get a helpful public reply from you first."
        actions={<Button onClick={run} loading={busy === 'run'} variant={queued ? 'default' : 'outline'}><Play className="h-4 w-4" />{queued ? `Read ${queued} queued video${queued === 1 ? '' : 's'}` : 'Refresh'}</Button>} />

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</p>}
      {data && !data.youtube && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><CircleAlert className="h-4 w-4" />Add YOUTUBE_API_KEY in Vercel to search videos and read comments.</p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile label="Tier A: reach out" value={c?.a} hint={`${c?.inLeadFinder ?? 0} sent to Lead Finder`} tone="text-emerald-700" />
        <Tile label="Tier B: reply publicly" value={c?.b} hint={`${c?.toReply ?? 0} waiting for a reply`} tone="text-indigo-700" />
        <Tile label="Replies today" value={c ? `${c.repliesToday}/${DAILY_REPLY_LIMIT}` : undefined} hint="stay under 15 a day" tone={c && c.repliesToday >= DAILY_REPLY_LIMIT ? 'text-red-600' : ''} />
        <Tile label="They answered" value={c?.responded} hint={`of ${(c?.replied ?? 0) + (c?.responded ?? 0)} replies sent`} tone="text-teal-700" />
        <Tile label="Ignored (Tier C)" value={c?.c} hint="kept out of your way" tone="text-slate-400" />
      </div>

      <FindVideos onSearched={() => mutate()} onQueued={() => { mutate(); setTab('VIDEOS') }} />

      <div className="flex gap-1 border-b border-slate-200">
        {([['REPLY', `Reply publicly (${replyList.filter((r) => r.replyStatus === 'TODO').length})`], ['A', `Reach out (${tierA.length})`], ['VIDEOS', `Videos and weekly review (${data?.videos.length ?? 0})`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-indigo-600 font-medium text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{label}</button>
        ))}
      </div>

      {tab === 'REPLY' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <p className="font-medium text-slate-800">You post these replies yourself, from your own YouTube account.</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">{REPLY_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
          {!replyList.length && data && <Empty text="No one is waiting for a reply. Search for videos above, collect their comments, and people with a missed-call problem will show up here." />}
          {replyList.map((r) => <ReplyCard key={r.id} r={r} busy={busy} post={post} onChanged={() => mutate()} limitReached={!!c && c.repliesToday >= DAILY_REPLY_LIMIT} />)}
        </div>
      )}

      {tab === 'A' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">These people said they miss calls <em>and</em> clearly run a business. Each one is sent to the <Link href="/finder" className="text-indigo-600 hover:underline">Lead Finder</Link>, which finds the business&apos;s own public email, checks it and adds it to the matching campaign. No personal emails are looked up.</p>
          {!tierA.length && data && <Empty text="No Tier A people yet. They appear when a commenter with a missed-call problem has a business name or website on their channel." />}
          {tierA.map((r) => <PersonCard key={r.id} r={r} />)}
        </div>
      )}

      {tab === 'VIDEOS' && <Videos videos={data?.videos || []} onChanged={() => mutate()} />}
    </div>
  )
}

function Tile({ label, value, hint, tone }: { label: string; value?: number | string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${tone || 'text-slate-900'}`}>{value ?? '—'}</p>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">{text}</div>
}

function Signals({ r }: { r: Row }) {
  return (
    <div className="flex flex-wrap gap-1">
      <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white tabular-nums" title="+5 per high-intent phrase, +3 medium, +1 low, -5 per negative signal">{r.score} points</span>
      {r.trade && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">{nicheOf(r.trade)?.label || r.trade}</span>}
      {r.signals.filter((s) => BUYER_SIGNAL_LABEL[s] && s !== 'short').map((s) => (
        <span key={s} className={`rounded-full px-2 py-0.5 text-[11px] ${isHighSignal(s) ? 'bg-emerald-50 text-emerald-700' : isNegativeSignal(s) ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'}`}>{BUYER_SIGNAL_LABEL[s]}</span>
      ))}
    </div>
  )
}

function Who({ r }: { r: Row }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium text-slate-900">
        {r.businessName || r.displayName}
        {r.businessName && r.businessName !== r.displayName && <span className="ml-1.5 font-normal text-slate-400">{r.displayName}</span>}
      </p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
        {r.location && <span>{r.location}</span>}
        {r.country && r.country !== 'US' && <span>{r.country}</span>}
        {r.lastCommentAt && <span>commented {fmtRelative(r.lastCommentAt)}</span>}
        <a href={r.channelUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-indigo-600 hover:underline">Channel<ExternalLink className="h-3 w-3" /></a>
        {r.website && <a href={r.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-indigo-600 hover:underline">{r.website.replace(/^https?:\/\//, '')}<ExternalLink className="h-3 w-3" /></a>}
      </p>
    </div>
  )
}

function Quote({ r }: { r: Row }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="whitespace-pre-wrap text-sm text-slate-700">&ldquo;{(r.bestCommentText || '').slice(0, 600)}{(r.bestCommentText || '').length > 600 ? '…' : ''}&rdquo;</p>
      <p className="mt-1 text-[11px] text-slate-400">
        {r.videoTitle ? <>on &ldquo;{r.videoTitle.slice(0, 90)}&rdquo;</> : null}
        {r.commentCount > 1 ? ` · ${r.commentCount} comments` : ''}
        {r.commentUrl && <a href={r.commentUrl} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 text-indigo-600 hover:underline">Open the comment<ExternalLink className="h-3 w-3" /></a>}
      </p>
    </div>
  )
}

function PersonCard({ r }: { r: Row }) {
  const waiting = !r.business
  return (
    <Card>
      <CardContent className="space-y-2.5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Who r={r} />
          <div className="text-right text-xs">
            {r.business ? (
              <>
                <p className={`font-medium ${r.business.status === 'READY' ? 'text-emerald-700' : r.business.status === 'IN_CAMPAIGN' ? 'text-indigo-700' : 'text-slate-600'}`}>{BIZ_STATUS[r.business.status] || r.business.status}</p>
                <p className="text-slate-400">{r.business.email || 'no email yet'} · fit {r.business.fitScore}</p>
                <Link href="/finder" className="text-indigo-600 hover:underline">Open Lead Finder</Link>
              </>
            ) : <p className="max-w-[220px] text-amber-700">No website or location yet, so the Lead Finder can&apos;t look them up. Reply publicly first.</p>}
          </div>
        </div>
        <Quote r={r} />
        <Signals r={r} />
        {waiting && r.replyStatus === 'NONE' && <p className="text-[11px] text-slate-400">Will move to the reply list on the next refresh.</p>}
      </CardContent>
    </Card>
  )
}

function ReplyCard({ r, busy, post, onChanged, limitReached }: { r: Row; busy: string; post: (b: Record<string, unknown>, key?: string) => Promise<unknown>; onChanged: () => void; limitReached: boolean }) {
  const [text, setText] = useState(r.suggestedReply)
  const [copied, setCopied] = useState(false)
  const [found, setFound] = useState(false)
  const [biz, setBiz] = useState({ website: r.website || '', businessName: r.businessName || '', location: r.location || '' })
  const [next, setNext] = useState(r.nextStep || '')

  const set = async (status: string, extra: Record<string, unknown> = {}) => { if (await post({ action: 'reply', id: r.id, status, ...extra }, `${r.id}:${status}`)) onChanged() }
  const copy = () => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => toast.error('Could not copy'))
  async function saveBusiness() {
    if (!biz.website.trim() && !(biz.businessName.trim() && biz.location.trim())) return toast.error('Add their website, or their business name and city/state')
    if (await post({ action: 'business', id: r.id, ...biz }, `${r.id}:biz`)) { toast.success('Saved. They are now Tier A and go to the Lead Finder.'); setFound(false); onChanged() }
  }

  return (
    <Card className={r.replyStatus === 'RESPONDED' ? 'border-teal-300' : ''}>
      <CardContent className="space-y-2.5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Who r={r} />
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.replyStatus === 'TODO' ? 'bg-amber-50 text-amber-700' : r.replyStatus === 'SENT' ? 'bg-sky-50 text-sky-700' : 'bg-teal-50 text-teal-700'}`}>
            {r.replyStatus === 'TODO' ? 'Reply needed' : r.replyStatus === 'SENT' ? `Replied ${r.replySentAt ? fmtRelative(r.replySentAt) : ''}: waiting for them` : 'They answered'}
          </span>
        </div>
        <Quote r={r} />
        <Signals r={r} />

        {r.replyStatus === 'TODO' && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Suggested reply: change the wording before you post</p>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={copy}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Copied' : 'Copy reply'}</Button>
              {r.commentUrl && <Button size="sm" variant="outline" asChild><a href={r.commentUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" />Open the comment</a></Button>}
              <Button size="sm" onClick={() => set('SENT')} loading={busy === `${r.id}:SENT`} disabled={limitReached} title={limitReached ? 'You have reached 15 replies today' : undefined}><MessageSquareReply className="h-3.5 w-3.5" />I posted it</Button>
              <Button size="sm" variant="ghost" className="text-slate-400" onClick={() => set('SKIPPED')} loading={busy === `${r.id}:SKIPPED`}><SkipForward className="h-3.5 w-3.5" />Skip</Button>
            </div>
          </div>
        )}

        {r.replyStatus !== 'TODO' && (
          <div className="flex flex-wrap items-center gap-2">
            {r.replyStatus === 'SENT' && <Button size="sm" onClick={() => set('RESPONDED')} loading={busy === `${r.id}:RESPONDED`}><Check className="h-3.5 w-3.5" />They answered</Button>}
            <Button size="sm" variant="outline" onClick={() => setFound((v) => !v)}><Building2 className="h-3.5 w-3.5" />I found their business</Button>
            <Input value={next} onChange={(e) => setNext(e.target.value)} onBlur={() => next !== (r.nextStep || '') && set(r.replyStatus, { nextStep: next })} placeholder="Next step (e.g. send demo number)" className="h-8 max-w-xs text-xs" />
            <Button size="sm" variant="ghost" className="text-slate-400" onClick={() => set('TODO')} title="Move back to Reply needed"><Undo2 className="h-3.5 w-3.5" /></Button>
          </div>
        )}
        {r.replyStatus === 'RESPONDED' && <p className="text-xs text-teal-800">They engaged: now share the demo number and a short summary, in the channel they chose. If they named their business, add it with &ldquo;I found their business&rdquo;.</p>}

        {found && (
          <div className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <Input value={biz.website} onChange={(e) => setBiz({ ...biz, website: e.target.value })} placeholder="Business website" className="h-9" />
            <Input value={biz.businessName} onChange={(e) => setBiz({ ...biz, businessName: e.target.value })} placeholder="Business name" className="h-9" />
            <Input value={biz.location} onChange={(e) => setBiz({ ...biz, location: e.target.value })} placeholder="City, ST" className="h-9" />
            <Button size="sm" className="h-9" onClick={saveBusiness} loading={busy === `${r.id}:biz`}>Send to Lead Finder</Button>
            <p className="text-[11px] text-slate-400 sm:col-span-4">Only the business&apos;s public details. The Lead Finder then finds the business email from its website or listing.</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function FindVideos({ onSearched, onQueued }: { onSearched: () => void; onQueued: () => void }) {
  const [group, setGroup] = useState<string>('Missed calls')
  const [q, setQ] = useState('')
  const [within, setWithin] = useState(90)
  const [busy, setBusy] = useState('')
  const [results, setResults] = useState<Video[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const groups = useMemo(() => [...new Set(BUYER_SEARCHES.map((s) => s.group))], [])

  async function search(query: string) {
    if (query.trim().length < 3) return toast.error('Type what to search for')
    setBusy(query); setQ(query)
    try {
      const res = await fetch('/api/audience/buyers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'search', q: query, withinDays: within }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(d.error || 'Search failed')
      const fresh: Video[] = (d.videos || []).filter((v: Video) => v.status === 'DISCOVERED')
      setResults(d.videos || [])
      // Pre-select the ones your plan prefers: recent, 5K-200K views, real comment sections
      setPicked(new Set(fresh.filter((v) => v.score >= 55).slice(0, 8).map((v) => v.id)))
      onSearched()
    } finally { setBusy('') }
  }

  async function queue() {
    if (!picked.size) return toast.error('Tick the videos to read')
    setBusy('queue')
    try {
      const res = await fetch('/api/audience/videos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'queue', ids: [...picked], maxComments: 1500 }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(d.error || 'Could not queue')
      toast.success(`${d.count} video${d.count === 1 ? '' : 's'} queued. Click "Read queued videos" at the top, or the background worker picks them up.`)
      setResults(null); setPicked(new Set()); onQueued()
    } finally { setBusy('') }
  }

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Search className="h-4 w-4 text-slate-400" />Find videos where business owners talk about calls</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {groups.map((g) => <button key={g} onClick={() => setGroup(g)} className={`rounded-full px-3 py-1 text-xs ${group === g ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{g}</button>)}
        </div>
        <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
          {BUYER_SEARCHES.filter((s) => s.group === group).map((s) => (
            <button key={s.q} onClick={() => search(s.q)} disabled={!!busy} title={s.q}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:border-indigo-400 hover:text-indigo-700 disabled:opacity-50">{busy === s.q ? 'Searching…' : s.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(q)} placeholder="Or type your own search" className="h-9 max-w-md flex-1" />
          <select value={within} onChange={(e) => setWithin(Number(e.target.value))} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
            <option value={31}>This month</option><option value={90}>Last 3 months</option><option value={365}>Last year</option><option value={0}>Any time</option>
          </select>
          <Button onClick={() => search(q)} loading={!!busy && busy !== 'queue'} variant="outline" className="h-9"><Search className="h-4 w-4" />Search</Button>
        </div>
        <p className="text-[11px] text-slate-400">Each search uses 100 of your 10,000 daily YouTube units. Videos with 5K to 200K views and a recent upload date score highest: huge videos are noisy and tiny ones have no comments.</p>

        {results && (
          <div className="space-y-2">
            {!results.length && <p className="text-sm text-slate-500">No videos found. Try &ldquo;Last year&rdquo; or a different phrase.</p>}
            <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {results.map((v) => {
                const done = v.status !== 'DISCOVERED'
                return (
                  <label key={v.id} className={`flex cursor-pointer items-start gap-3 px-3 py-2 ${done ? 'opacity-60' : 'hover:bg-slate-50'}`}>
                    <input type="checkbox" className="mt-1" disabled={done} checked={picked.has(v.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(v.id); else n.delete(v.id); setPicked(n) }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-800">{v.title}</span>
                      <span className="block text-[11px] text-slate-500">{v.channel.title} · {v.scoreReasons}{done ? ` · already ${v.status.toLowerCase()}` : ''}</span>
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${v.score >= 55 ? 'bg-emerald-50 text-emerald-700' : v.score >= 35 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{v.score}</span>
                  </label>
                )
              })}
            </div>
            {results.length > 0 && <Button onClick={queue} loading={busy === 'queue'} disabled={!picked.size}><ListVideo className="h-4 w-4" />Read the comments of {picked.size} video{picked.size === 1 ? '' : 's'}</Button>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Videos({ videos, onChanged }: { videos: Video[]; onChanged: () => void }) {
  const [busy, setBusy] = useState('')
  async function act(action: 'queue' | 'skip', id: string) {
    setBusy(id)
    try {
      const res = await fetch('/api/audience/videos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ids: [id], maxComments: 1500 }) })
      if (!res.ok) toast.error('Could not update the video')
      onChanged()
    } finally { setBusy('') }
  }
  const sorted = [...videos].sort((a, b) => ((b.yield?.a || 0) * 3 + (b.yield?.b || 0)) - ((a.yield?.a || 0) * 3 + (a.yield?.b || 0)) || b.score - a.score)
  if (!videos.length) return <Empty text="No buyer videos yet. Use a search above, tick the videos you want and read their comments." />
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <p className="border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500">Weekly review: keep searching the phrases behind the videos at the top, and drop the ones that produce nobody.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2">Video</th><th className="px-2 py-2 text-right">Comments read</th><th className="px-2 py-2 text-right">Tier A</th><th className="px-2 py-2 text-right">Tier B</th><th className="px-2 py-2 text-right">Replied</th><th className="px-2 py-2 text-right">Answered</th><th className="px-4 py-2">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((v) => (
                <tr key={v.id}>
                  <td className="max-w-md px-4 py-2">
                    <a href={`https://www.youtube.com/watch?v=${v.youtubeVideoId}`} target="_blank" rel="noreferrer" className="block truncate text-slate-800 hover:text-indigo-700">{v.title}</a>
                    <span className="block truncate text-[11px] text-slate-400">{v.channel.title} · {v.viewCount.toLocaleString('en-US')} views · fit {v.score}{v.lastError ? ` · ${v.lastError}` : ''}</span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600">{v.commentsCollected.toLocaleString('en-US')}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-medium text-emerald-700">{v.yield?.a || 0}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-indigo-700">{v.yield?.b || 0}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600">{v.yield?.sent || 0}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-teal-700">{v.yield?.responded || 0}</td>
                  <td className="px-4 py-2 text-xs">
                    <span className="mr-2 text-slate-500">{v.status.toLowerCase()}</span>
                    {['DISCOVERED', 'DONE', 'SKIPPED', 'ERROR'].includes(v.status) && <button onClick={() => act('queue', v.id)} disabled={busy === v.id} className="text-indigo-600 hover:underline">{v.status === 'DONE' ? 'Read new comments' : 'Read comments'}</button>}
                    {v.status === 'DISCOVERED' && <button onClick={() => act('skip', v.id)} disabled={busy === v.id} className="ml-2 text-slate-400 hover:underline">Skip</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
