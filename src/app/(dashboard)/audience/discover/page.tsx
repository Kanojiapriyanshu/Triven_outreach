'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { toast } from 'sonner'
import {
  Telescope, Search, Link2, ListVideo, RefreshCw, Trash2, Eye, EyeOff, Play, SkipForward, Users, MessageSquare, ExternalLink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import PipelineRunner from '@/components/audience/PipelineRunner'
import { fmtNum, Avatar } from '@/components/audience/badges'
import { COUNTRIES, ENGLISH_COUNTRIES, SEARCH_PRESETS, INTERESTS, type Interest } from '@/lib/audience/taxonomy'
import { fmtRelative } from '@/lib/utils'
import { videoUrl } from '@/lib/audience/links'
import { flag } from '@/lib/audience/country'
import PageHeader from '@/components/layout/PageHeader'

const fetcher = (url: string) => fetch(url).then(async (r) => {
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'Request failed')
  return d
})

interface Video {
  id: string; youtubeVideoId: string; title: string; thumbnailUrl: string | null; publishedAt: string | null
  viewCount: number; commentCount: number; likeCount: number; durationSeconds: number
  score: number; scoreReasons: string | null; interestCategory: string | null
  status: string; commentsCollected: number; maxComments: number; lastError: string | null; lastCollectedAt: string | null
  platform?: string; url?: string | null; description?: string | null
  channel: { id?: string; title: string; handle: string | null; country?: string | null }
  relevantComments?: number
}
interface Channel {
  id: string; youtubeChannelId: string; platform: string; title: string; handle: string | null; thumbnailUrl: string | null; description: string | null
  subscriberCount: number; videoCount: number; topicScore: number; isTracked: boolean; lastScannedAt: string | null; country: string | null
  _count: { videos: number }
}

const TABS = [
  { key: 'search', label: 'Find videos', icon: Search },
  { key: 'channels', label: 'Channels', icon: Users },
  { key: 'hn', label: 'Hacker News', icon: MessageSquare },
  { key: 'queue', label: 'Collection', icon: ListVideo },
] as const

const STATUS_STYLE: Record<string, string> = {
  DISCOVERED: 'bg-slate-100 text-slate-600', QUEUED: 'bg-amber-100 text-amber-700', COLLECTING: 'bg-indigo-100 text-indigo-700',
  DONE: 'bg-emerald-100 text-emerald-700', SKIPPED: 'bg-slate-100 text-slate-400', ERROR: 'bg-red-100 text-red-600',
}

function duration(s: number) {
  if (!s) return ''
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

export default function DiscoverPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('search')
  const { data: overview, mutate: mutateOverview } = useSWR<{ quota: { used: number; limit: number; left: number }; backlog: { videos: number; review: number; enrich: number; verify: number; total: number }; config: { youtube: boolean } }>('/api/audience/overview', fetcher, { refreshInterval: 30_000 })

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader
        section="Audience"
        title="Discover"
        icon={Telescope}
        description="Find conversations where builders talk about AI: YouTube videos and Hacker News threads. Target a country, then collect the comments."
        actions={
          <div className="text-right">
            <PipelineRunner backlog={overview?.backlog} onProgress={() => mutateOverview()} />
            {overview && <p className="text-[11px] text-slate-400 mt-1">YouTube quota left today: {overview.quota.left.toLocaleString('en-US')} units (a search costs 100)</p>}
          </div>
        }
      />

      {overview && !overview.config.youtube && (
        <Card className="border-amber-200 bg-amber-50"><CardContent className="p-4 text-sm text-amber-800">
          Add <code className="font-mono">YOUTUBE_API_KEY</code> to the environment (and redeploy) to search YouTube and collect comments.
        </CardContent></Card>
      )}

      <AddByLink onAdded={() => mutateOverview()} />

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px ${tab === t.key ? 'border-indigo-600 text-indigo-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {tab === 'search' && <SearchTab onQueued={() => { mutateOverview(); setTab('queue') }} />}
      {tab === 'channels' && <ChannelsTab />}
      {tab === 'hn' && <HnTab onQueued={() => { mutateOverview(); setTab('queue') }} />}
      {tab === 'queue' && <QueueTab />}
    </div>
  )
}

// ─── Paste a link ────────────────────────────────────────────────────────────

function AddByLink({ onAdded }: { onAdded: () => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  async function add(queue: boolean) {
    if (!value.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/audience/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: value, queue }) })
      const d = await res.json()
      if (!res.ok) return toast.error(d.error || 'Could not add')
      if (d.kind === 'video') toast.success(queue ? `Queued "${d.videos[0].title}" for comment collection` : `Saved "${d.videos[0].title}"`)
      else toast.success(`Added ${d.channels.length} channel${d.channels.length === 1 ? '' : 's'}. Open Channels to scan their latest videos.`)
      setValue('')
      onAdded()
    } finally { setBusy(false) }
  }
  return (
    <Card>
      <CardContent className="p-4 flex flex-wrap items-center gap-2">
        <Link2 className="h-4 w-4 text-slate-400" />
        <Input value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add(true)}
          placeholder="Paste a YouTube video link, a channel link or @handle, or type a channel name" className="flex-1 min-w-[260px]" />
        <Button size="sm" onClick={() => add(true)} loading={busy} disabled={!value.trim()}>Add &amp; collect</Button>
        <Button size="sm" variant="outline" onClick={() => add(false)} disabled={busy || !value.trim()}>Just save</Button>
      </CardContent>
    </Card>
  )
}

// ─── Search ──────────────────────────────────────────────────────────────────

function SearchTab({ onQueued }: { onQueued: () => void }) {
  const [q, setQ] = useState('')
  const [region, setRegion] = useState('')
  const [within, setWithin] = useState(365)
  const [durationFilter, setDurationFilter] = useState<'any' | 'medium' | 'long'>('medium')
  const [order, setOrder] = useState<'relevance' | 'viewCount' | 'date'>('relevance')
  const [results, setResults] = useState<Video[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [searching, setSearching] = useState(false)
  const [maxComments, setMaxComments] = useState(2000)
  const [localOnly, setLocalOnly] = useState(false)

  async function search(query = q) {
    if (query.trim().length < 2) return toast.error('Type what to search for')
    setSearching(true)
    try {
      const res = await fetch('/api/audience/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, regionCode: region, publishedWithinDays: within || undefined, duration: durationFilter, order }),
      })
      const d = await res.json()
      if (!res.ok) return toast.error(d.error || 'Search failed')
      setResults(d.videos)
      // Pre-select the videos that look best for the audience
      setSelected(new Set(d.videos.filter((v: Video) => v.score >= 55 && v.commentCount >= 50 && v.status === 'DISCOVERED').map((v: Video) => v.id)))
    } finally { setSearching(false) }
  }

  async function queue() {
    const res = await fetch('/api/audience/videos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'queue', ids: [...selected], maxComments }) })
    const d = await res.json()
    if (!res.ok) return toast.error(d.error || 'Could not queue')
    toast.success(`${d.count} video${d.count === 1 ? '' : 's'} queued. Comments are collected in the background, or press Run pipeline now.`)
    setSelected(new Set())
    onQueued()
  }

  const estimate = useMemo(() => results.filter((v) => selected.has(v.id)).reduce((n, v) => n + Math.min(v.commentCount, maxComments), 0), [results, selected, maxComments])

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {SEARCH_PRESETS.map((p) => (
              <button key={p.label} onClick={() => { setQ(p.q); search(p.q) }} disabled={searching}
                className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 hover:border-indigo-400 hover:text-indigo-700">
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="e.g. build AI voice agent for clinics" className="flex-1 min-w-[240px]" />
            <select value={region} onChange={(e) => setRegion(e.target.value)} className="h-9 rounded-lg border border-slate-300 px-2 text-sm" title="Lean results towards a country (still English)">
              <option value="">All English-speaking</option>
              {ENGLISH_COUNTRIES.map((c) => <option key={c} value={c}>{COUNTRIES[c].name}</option>)}
            </select>
            <select value={within} onChange={(e) => setWithin(Number(e.target.value))} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
              <option value={30}>Last 30 days</option><option value={90}>Last 3 months</option><option value={365}>Last year</option><option value={730}>Last 2 years</option><option value={0}>Any time</option>
            </select>
            <select value={durationFilter} onChange={(e) => setDurationFilter(e.target.value as 'any' | 'medium' | 'long')} className="h-9 rounded-lg border border-slate-300 px-2 text-sm" title="Shorts attract drive-by comments">
              <option value="medium">4–20 min</option><option value="long">20+ min</option><option value="any">Any length</option>
            </select>
            <select value={order} onChange={(e) => setOrder(e.target.value as 'relevance' | 'viewCount' | 'date')} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
              <option value="relevance">Most relevant</option><option value="viewCount">Most viewed</option><option value="date">Newest</option>
            </select>
            <Button onClick={() => search()} loading={searching}><Search className="h-4 w-4" />Search</Button>
          </div>
          {region && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={localOnly} onChange={(e) => setLocalOnly(e.target.checked)} />
              Only creators based in {COUNTRIES[region]?.name}: their audience is mostly local, so commenters are too
            </label>
          )}
        </CardContent>
      </Card>

      {results.length > 0 && (
        <div className="sticky top-14 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50/95 px-4 py-2.5 backdrop-blur">
          <span className="text-sm text-indigo-900">
            <strong>{selected.size}</strong> selected · up to {estimate.toLocaleString('en-US')} comments ({Math.ceil(estimate / 100)} quota units)
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-indigo-800">Max per video</span>
            <Input type="number" min={100} step={100} value={maxComments} onChange={(e) => setMaxComments(Math.max(100, Number(e.target.value) || 100))} className="h-8 w-24 bg-white" />
            <Button size="sm" onClick={queue} disabled={!selected.size}><Play className="h-3.5 w-3.5" />Collect comments</Button>
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {results.filter((v) => !localOnly || !region || v.channel.country === region).map((v) => (
          <VideoCard key={v.id} v={v} checked={selected.has(v.id)} onToggle={() => setSelected((s) => { const n = new Set(s); if (n.has(v.id)) n.delete(v.id); else n.add(v.id); return n })} />
        ))}
      </div>
      {!results.length && !searching && (
        <p className="text-sm text-slate-400 text-center py-10">
          Pick a preset or search. Each result is scored for audience fit: builder topics, how talkative the audience is, recency and length.
        </p>
      )}
    </div>
  )
}

function VideoCard({ v, checked, onToggle }: { v: Video; checked: boolean; onToggle: () => void }) {
  const tone = v.score >= 65 ? 'text-emerald-700 bg-emerald-50' : v.score >= 45 ? 'text-sky-700 bg-sky-50' : 'text-slate-500 bg-slate-50'
  return (
    <Card className={checked ? 'ring-2 ring-indigo-500' : ''}>
      <div className="flex gap-3 p-3">
        <button onClick={onToggle} className="relative shrink-0" title={checked ? 'Unselect' : 'Select'}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {v.thumbnailUrl ? <img src={v.thumbnailUrl} alt="" className="h-20 w-36 rounded-md object-cover" /> : <div className="h-20 w-36 rounded-md bg-slate-100" />}
          <input type="checkbox" checked={checked} readOnly className="absolute left-1.5 top-1.5" />
          {v.durationSeconds > 0 && <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[10px] text-white">{duration(v.durationSeconds)}</span>}
        </button>
        <div className="min-w-0 flex-1">
          <a href={videoUrl(v.platform, v.youtubeVideoId)} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm font-medium text-slate-900 hover:text-indigo-600">{v.title}</a>
          <p className="text-xs text-slate-500 truncate">{v.channel.title}{v.channel.country ? ` · ${flag(v.channel.country)} ${COUNTRIES[v.channel.country]?.name || v.channel.country}` : ''}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {fmtNum(v.viewCount)} views · <MessageSquare className="inline h-3 w-3 -mt-0.5" /> {fmtNum(v.commentCount)} · {v.publishedAt ? fmtRelative(v.publishedAt) : ''}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone}`} title={v.scoreReasons || ''}>Fit {v.score}</span>
            {v.interestCategory && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{INTERESTS[v.interestCategory as Interest]?.label}</Badge>}
            {v.status !== 'DISCOVERED' && <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[v.status]}`}>{v.status.toLowerCase()}</span>}
          </div>
        </div>
      </div>
      {v.scoreReasons && <p className="px-3 pb-2.5 -mt-1 text-[11px] text-slate-400 line-clamp-1" title={v.scoreReasons}>{v.scoreReasons}</p>}
    </Card>
  )
}

// ─── Channels ────────────────────────────────────────────────────────────────

function ChannelsTab() {
  const { data, mutate } = useSWR<Channel[]>('/api/audience/channels', fetcher)
  const [busy, setBusy] = useState<string | null>(null)
  const [findQ, setFindQ] = useState('')
  const [findRegion, setFindRegion] = useState('')

  async function findChannels() {
    if (findQ.trim().length < 2) return toast.error('Type a topic, e.g. "AI automation"')
    setBusy('find')
    try {
      const res = await fetch('/api/audience/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: findQ, regionCode: findRegion }) })
      const d = await res.json()
      if (!res.ok) return toast.error(d.error || 'Search failed')
      const local = findRegion ? d.channels.filter((c: Channel) => c.country === findRegion).length : 0
      toast.success(`Added ${d.channels.length} channel${d.channels.length === 1 ? '' : 's'}${findRegion ? ` (${local} based in ${COUNTRIES[findRegion]?.name})` : ''}. Scan them to pick videos.`)
      mutate()
    } finally { setBusy(null) }
  }
  const [scanned, setScanned] = useState<{ channel: string; videos: Video[] } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const channels = Array.isArray(data) ? data : []

  async function scan(c: Channel) {
    setBusy(c.id)
    try {
      const res = await fetch(`/api/audience/channels/${c.id}/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ max: 50 }) })
      const d = await res.json()
      if (!res.ok) return toast.error(d.error || 'Scan failed')
      setScanned({ channel: c.title, videos: d.videos })
      setSelected(new Set(d.videos.filter((v: Video) => v.score >= 55 && v.commentCount >= 50 && v.status === 'DISCOVERED').slice(0, 10).map((v: Video) => v.id)))
      mutate()
    } finally { setBusy(null) }
  }

  async function toggleTrack(c: Channel) {
    await fetch(`/api/audience/channels/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isTracked: !c.isTracked }) })
    mutate()
  }

  async function remove(c: Channel) {
    if (!confirm(`Remove ${c.title}? Its videos and collected comments are deleted. People who are already leads stay in the CRM.`)) return
    await fetch(`/api/audience/channels/${c.id}`, { method: 'DELETE' })
    toast.success('Channel removed')
    mutate()
  }

  async function queue() {
    const res = await fetch('/api/audience/videos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'queue', ids: [...selected] }) })
    const d = await res.json()
    if (!res.ok) return toast.error(d.error || 'Could not queue')
    toast.success(`${d.count} video${d.count === 1 ? '' : 's'} queued for collection`)
    setScanned(null)
  }

  return (
    <div className="space-y-4">
      {scanned && (
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm">Latest videos from {scanned.channel}</CardTitle>
              <CardDescription>Best fits are pre-selected.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setScanned(null)}>Close</Button>
              <Button size="sm" onClick={queue} disabled={!selected.size}><Play className="h-3.5 w-3.5" />Collect {selected.size}</Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {scanned.videos.map((v) => (
              <VideoCard key={v.id} v={v} checked={selected.has(v.id)} onToggle={() => setSelected((s) => { const n = new Set(s); if (n.has(v.id)) n.delete(v.id); else n.add(v.id); return n })} />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Find creators</span>
          <Input value={findQ} onChange={(e) => setFindQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && findChannels()} placeholder="Topic, e.g. AI automation agency" className="flex-1 min-w-[220px]" />
          <select value={findRegion} onChange={(e) => setFindRegion(e.target.value)} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
            <option value="">Any country</option>
            {ENGLISH_COUNTRIES.map((c) => <option key={c} value={c}>{COUNTRIES[c].name}</option>)}
          </select>
          <Button size="sm" onClick={findChannels} loading={busy === 'find'}><Search className="h-3.5 w-3.5" />Find (100 units)</Button>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase">
              <th className="text-left px-4 py-2.5 font-semibold">Channel</th>
              <th className="text-right px-3 py-2.5 font-semibold">Subscribers</th>
              <th className="text-right px-3 py-2.5 font-semibold">On-topic</th>
              <th className="text-right px-3 py-2.5 font-semibold">Videos saved</th>
              <th className="text-left px-3 py-2.5 font-semibold">Last scan</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {channels.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Channels appear here when you search or paste a link.</td></tr>
            )}
            {channels.map((c) => (
              <tr key={c.id} className={`border-b border-slate-100 ${c.isTracked ? '' : 'opacity-50'}`}>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar src={c.thumbnailUrl} name={c.title} size={28} />
                    <div className="min-w-0">
                      <a href={c.platform === 'HN' ? 'https://news.ycombinator.com' : `https://www.youtube.com/channel/${c.youtubeChannelId}`} target="_blank" rel="noreferrer" className="font-medium text-slate-800 hover:text-indigo-600">{c.title}</a>
                      <p className="text-[11px] text-slate-400 truncate max-w-md">{c.handle} {c.country ? `· ${COUNTRIES[c.country]?.name || c.country}` : ''}</p>
                    </div>
                  </div>
                </td>
                <td className="text-right px-3 tabular-nums">{fmtNum(c.subscriberCount)}</td>
                <td className="text-right px-3 tabular-nums">{c.topicScore}</td>
                <td className="text-right px-3 tabular-nums">{c._count.videos}</td>
                <td className="px-3 text-xs text-slate-500">{c.lastScannedAt ? fmtRelative(c.lastScannedAt) : 'never'}</td>
                <td className="px-3">
                  <div className="flex justify-end gap-1">
                    {c.platform !== 'HN' && <Button size="sm" variant="outline" onClick={() => scan(c)} loading={busy === c.id}><RefreshCw className="h-3.5 w-3.5" />Scan latest</Button>}
                    <Button size="sm" variant="ghost" asChild title="People from this channel"><Link href={`/audience/prospects?channelId=${c.id}`}><Users className="h-4 w-4" /></Link></Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleTrack(c)} title={c.isTracked ? 'Stop tracking' : 'Track'}>{c.isTracked ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</Button>
                    <Button size="sm" variant="ghost" className="text-slate-400 hover:text-red-500" onClick={() => remove(c)} title="Remove"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

// ─── Collection queue ────────────────────────────────────────────────────────

function QueueTab() {
  const [filter, setFilter] = useState('QUEUED,COLLECTING,DONE,ERROR')
  const { data, mutate } = useSWR<Video[]>(`/api/audience/videos?status=${filter}`, fetcher, { refreshInterval: 15_000 })
  const videos = Array.isArray(data) ? data : []

  async function act(action: 'queue' | 'skip' | 'delete', ids: string[]) {
    if (action === 'delete' && !confirm('Delete this video and the comments collected from it?')) return
    const res = await fetch('/api/audience/videos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ids }) })
    if (!res.ok) return toast.error('Could not update')
    mutate()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {[
          ['QUEUED,COLLECTING,DONE,ERROR', 'All collected'], ['QUEUED,COLLECTING', 'In progress'], ['DONE', 'Done'], ['ERROR,SKIPPED', 'Skipped / errors'], ['DISCOVERED', 'Saved, not collected'],
        ].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)} className={`rounded-full border px-2.5 py-1 text-xs ${filter === v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300'}`}>{l}</button>
        ))}
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase">
              <th className="text-left px-4 py-2.5 font-semibold">Video</th>
              <th className="text-left px-3 py-2.5 font-semibold">Status</th>
              <th className="text-left px-3 py-2.5 font-semibold w-56">Collected</th>
              <th className="text-right px-3 py-2.5 font-semibold">Relevant comments</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {videos.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Nothing here yet.</td></tr>}
            {videos.map((v) => {
              const target = Math.max(1, Math.min(v.commentCount || v.maxComments, v.maxComments))
              return (
                <tr key={v.id} className="border-b border-slate-100">
                  <td className="px-4 py-2.5">
                    <a href={videoUrl(v.platform, v.youtubeVideoId)} target="_blank" rel="noreferrer" className="font-medium text-slate-800 hover:text-indigo-600 line-clamp-1">{v.title}</a>
                    <p className="text-[11px] text-slate-400">{v.channel.title} · fit {v.score} · {fmtNum(v.commentCount)} comments on YouTube</p>
                    {v.lastError && <p className="text-[11px] text-red-500">{v.lastError}</p>}
                  </td>
                  <td className="px-3"><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[v.status]}`}>{v.status.toLowerCase()}</span></td>
                  <td className="px-3">
                    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, (v.commentsCollected / target) * 100)}%` }} />
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">{v.commentsCollected.toLocaleString('en-US')} / {target.toLocaleString('en-US')}{v.lastCollectedAt ? ` · ${fmtRelative(v.lastCollectedAt)}` : ''}</p>
                  </td>
                  <td className="text-right px-3 tabular-nums">
                    {v.relevantComments ? <Link href={`/audience/prospects?videoId=${v.id}`} className="font-semibold text-indigo-600 hover:underline">{v.relevantComments}</Link> : '–'}
                  </td>
                  <td className="px-3">
                    <div className="flex justify-end gap-1">
                      {['DONE', 'ERROR', 'SKIPPED', 'DISCOVERED'].includes(v.status) && (
                        <Button size="sm" variant="outline" onClick={() => act('queue', [v.id])} title={v.status === 'DONE' ? 'Collect new comments since last time' : 'Collect'}><RefreshCw className="h-3.5 w-3.5" />{v.status === 'DONE' ? 'Refresh' : 'Collect'}</Button>
                      )}
                      {['QUEUED', 'COLLECTING'].includes(v.status) && <Button size="sm" variant="ghost" onClick={() => act('skip', [v.id])} title="Stop collecting"><SkipForward className="h-4 w-4" /></Button>}
                      <Button size="sm" variant="ghost" asChild title="Open"><a href={videoUrl(v.platform, v.youtubeVideoId)} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a></Button>
                      <Button size="sm" variant="ghost" className="text-slate-400 hover:text-red-500" onClick={() => act('delete', [v.id])}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

// ─── Hacker News ─────────────────────────────────────────────────────────────

const HN_PRESETS = [
  { label: 'Show HN: AI agents', q: 'Show HN agent' },
  { label: 'AI agents in production', q: 'AI agents production' },
  { label: 'Voice AI', q: 'voice AI agent' },
  { label: 'LLM apps', q: 'LLM app' },
  { label: 'Workflow automation', q: 'workflow automation AI' },
  { label: 'Ask HN: AI for business', q: 'Ask HN AI business' },
  { label: 'AI customer support', q: 'AI customer support' },
  { label: 'AI sales / SDR', q: 'AI SDR sales' },
]

function HnTab({ onQueued }: { onQueued: () => void }) {
  const [q, setQ] = useState('')
  const [minComments, setMinComments] = useState(30)
  const [since, setSince] = useState(365)
  const [sort, setSort] = useState<'relevance' | 'date'>('relevance')
  const [results, setResults] = useState<Video[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [searching, setSearching] = useState(false)

  async function search(query = q) {
    if (query.trim().length < 2) return toast.error('Type what to search for')
    setSearching(true)
    try {
      const res = await fetch('/api/audience/hn', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, minComments, sinceDays: since || undefined, sort }),
      })
      const d = await res.json()
      if (!res.ok) return toast.error(d.error || 'Search failed')
      setResults(d.videos)
      setSelected(new Set(d.videos.filter((v: Video) => v.score >= 55 && v.status === 'DISCOVERED').slice(0, 10).map((v: Video) => v.id)))
    } finally { setSearching(false) }
  }

  async function queue() {
    const res = await fetch('/api/audience/videos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'queue', ids: [...selected] }) })
    const d = await res.json()
    if (!res.ok) return toast.error(d.error || 'Could not queue')
    toast.success(`${d.count} thread${d.count === 1 ? '' : 's'} queued. Hacker News is free: no quota used.`)
    setSelected(new Set())
    onQueued()
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-slate-500">
            Developers and founders discussing AI agents, automation and LLM apps. Free, no API key, no quota.
            People often put their site or email in their Hacker News profile, which the research step reads.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {HN_PRESETS.map((p) => (
              <button key={p.label} onClick={() => { setQ(p.q); search(p.q) }} disabled={searching}
                className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 hover:border-indigo-400 hover:text-indigo-700">{p.label}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="e.g. AI agent for small business" className="flex-1 min-w-[240px]" />
            <select value={minComments} onChange={(e) => setMinComments(Number(e.target.value))} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
              <option value={10}>10+ comments</option><option value={30}>30+ comments</option><option value={100}>100+ comments</option><option value={300}>300+ comments</option>
            </select>
            <select value={since} onChange={(e) => setSince(Number(e.target.value))} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
              <option value={90}>Last 3 months</option><option value={365}>Last year</option><option value={730}>Last 2 years</option><option value={0}>Any time</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as 'relevance' | 'date')} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
              <option value="relevance">Most relevant</option><option value="date">Newest</option>
            </select>
            <Button onClick={() => search()} loading={searching}><Search className="h-4 w-4" />Search</Button>
          </div>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <div className="sticky top-14 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50/95 px-4 py-2.5 backdrop-blur">
          <span className="text-sm text-indigo-900"><strong>{selected.size}</strong> selected · {results.filter((v) => selected.has(v.id)).reduce((n, v) => n + v.commentCount, 0).toLocaleString('en-US')} comments</span>
          <Button size="sm" onClick={queue} disabled={!selected.size}><Play className="h-3.5 w-3.5" />Collect comments</Button>
        </div>
      )}

      <Card className="overflow-hidden divide-y divide-slate-100">
        {results.map((v) => (
          <label key={v.id} className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 ${selected.has(v.id) ? 'bg-indigo-50/40' : ''}`}>
            <input type="checkbox" className="mt-1" checked={selected.has(v.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(v.id)) n.delete(v.id); else n.add(v.id); return n })} />
            <div className="min-w-0 flex-1">
              <a href={videoUrl('HN', v.youtubeVideoId)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-sm font-medium text-slate-900 hover:text-indigo-600">{v.title}</a>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {v.likeCount} points · <MessageSquare className="inline h-3 w-3 -mt-0.5" /> {v.commentCount.toLocaleString('en-US')} comments · {v.publishedAt ? fmtRelative(v.publishedAt) : ''}
                {v.description && <> · <span className="text-slate-400">{v.description.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50)}</span></>}
              </p>
            </div>
            <div className="text-right shrink-0">
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${v.score >= 65 ? 'text-emerald-700 bg-emerald-50' : v.score >= 45 ? 'text-sky-700 bg-sky-50' : 'text-slate-500 bg-slate-50'}`} title={v.scoreReasons || ''}>Fit {v.score}</span>
              {v.status !== 'DISCOVERED' && <p className={`mt-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[v.status]}`}>{v.status.toLowerCase()}</p>}
            </div>
          </label>
        ))}
      </Card>
      {!results.length && !searching && <p className="text-sm text-slate-400 text-center py-10">Pick a preset or search Hacker News threads.</p>}
    </div>
  )
}
