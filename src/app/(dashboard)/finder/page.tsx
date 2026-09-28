'use client'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { toast } from 'sonner'
import {
  MapPinned, Search, Star, Phone, Globe, Mail, ShieldCheck, ShieldQuestion, SlidersHorizontal, Download, RefreshCw, Trash2, Ban,
  Megaphone, ChevronDown, ChevronUp, X, Building2, PhoneCall, CheckCircle2, Loader2, CircleAlert, Undo2, Play,
} from 'lucide-react'
import PageHeader from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import FinderRunner from '@/components/finder/FinderRunner'
import FinderPushDialog from '@/components/finder/FinderPushDialog'
import BusinessDialog from '@/components/finder/BusinessDialog'
import { BizStatusBadge, TierBadge, FitBar } from '@/components/finder/badges'
import { NICHES, LOCATION_PRESETS, nicheOf } from '@/lib/finder/niches'
import { flag } from '@/lib/audience/country'
import { fmtRelative } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(async (r) => {
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'Request failed')
  return d
})

interface Settings {
  googleMonthlyCap: number; sendPolicy: 'VERIFIED_ONLY' | 'VERIFIED_OR_PUBLISHED'; excludeChains: boolean; minReviews: number; minRating: number
  autoResearch: boolean; useWebSearch: boolean; useHunter: boolean; guessEmails: boolean
}
interface Overview {
  status: Record<string, number>; tiers: Record<string, number>; callList: number; total: number
  backlog: { searches: number; research: number; total: number }; settings: Settings
  google: { configured: boolean; used: number; cap: number }
  services: { google: boolean; search: string | null; verifier: string | null; hunter: { remaining: number | null; available: number | null } | null }
}
interface SearchRow {
  id: string; query: string; niche: string | null; locations: string[]; country: string | null; provider: string; status: string
  found: number; added: number; duplicates: number; filtered: number; lastError: string | null; createdAt: string; counts: Record<string, number>
}
interface Row {
  id: string; name: string; niche: string | null; category: string | null; city: string | null; state: string | null; country: string | null
  phone: string | null; website: string | null; rating: number | null; reviewCount: number; hours: string | null; ownerName: string | null
  fitScore: number; fitReasons: string[]; tier: string; status: string; siteFacts: string[]; techSignals: string[]; createdAt: string
  email: { email: string; status: string; source: string; isRole: boolean; sendable: boolean; personName: string | null } | null
  emailCount: number; lead: { id: string; campaign: { name: string } | null } | null
}

const COUNTRY_OPTIONS = [['US', 'United States'], ['CA', 'Canada'], ['GB', 'United Kingdom'], ['AU', 'Australia'], ['NZ', 'New Zealand'], ['IE', 'Ireland'], ['IN', 'India'], ['AE', 'UAE'], ['SG', 'Singapore'], ['ZA', 'South Africa']]

const VIEWS = [
  { key: 'READY', label: 'Ready to email', icon: CheckCircle2 },
  { key: 'ALL', label: 'All', icon: Building2 },
  { key: 'RESEARCHING,NEW', label: 'Researching', icon: Loader2 },
  { key: 'EMAIL_FOUND', label: 'Unconfirmed email', icon: ShieldQuestion },
  { key: 'CALL', label: 'Call list', icon: PhoneCall },
  { key: 'IN_CAMPAIGN', label: 'In campaign', icon: Megaphone },
  { key: 'EXCLUDED', label: 'Excluded', icon: Ban },
] as const

export default function FinderPage() {
  return <Suspense><Finder /></Suspense>
}

function Finder() {
  const params = useSearchParams()
  const [view, setView] = useState<string>(params.get('status') || 'ALL')
  const [searchFilter, setSearchFilter] = useState(params.get('search') || '')
  const [nicheFilter, setNicheFilter] = useState('')
  const [q, setQ] = useState(params.get('q') || '')
  const [sort, setSort] = useState('fit')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [allMatching, setAllMatching] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [pushIds, setPushIds] = useState<string[] | null>(null)
  const [showSettings, setShowSettings] = useState(params.get('settings') === '1')
  const [showSearches, setShowSearches] = useState(true)

  const { data: overview, mutate: mutateOverview } = useSWR<Overview>('/api/finder/overview', fetcher, { refreshInterval: 20_000 })
  const { data: searches, mutate: mutateSearches } = useSWR<SearchRow[]>('/api/finder/searches', fetcher, { refreshInterval: 20_000 })
  const filter = useMemo(() => {
    const sp = new URLSearchParams()
    if (view !== 'ALL') sp.set('status', view)
    if (searchFilter) sp.set('search', searchFilter)
    if (nicheFilter) sp.set('niche', nicheFilter)
    if (q.trim()) sp.set('q', q.trim())
    if (sort !== 'fit') sp.set('sort', sort)
    return sp.toString()
  }, [view, searchFilter, nicheFilter, q, sort])
  const { data: list, mutate: mutateList, isLoading } = useSWR<{ items: Row[]; total: number; pages: number }>(`/api/finder/businesses?${filter}&page=${page}`, fetcher, { refreshInterval: 20_000, keepPreviousData: true })

  useEffect(() => { setPage(1); setSelected(new Set()); setAllMatching(false) }, [filter])

  const refresh = () => { mutateOverview(); mutateSearches(); mutateList() }
  const rows = list?.items || []
  const selCount = allMatching ? list?.total || 0 : selected.size
  const selNiches = [...new Set((allMatching ? rows : rows.filter((r) => selected.has(r.id))).map((r) => r.niche || ''))]
  const st = overview?.status || {}

  async function bulk(action: 'research' | 'exclude' | 'restore' | 'delete') {
    if (action === 'delete' && !confirm(`Delete ${selCount} businesses? Ones already in a campaign are kept.`)) return
    const res = await fetch('/api/finder/businesses/bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...(allMatching ? { filter } : { ids: [...selected] }) }),
    })
    const d = await res.json()
    if (!res.ok) return toast.error(d.error || 'Failed')
    toast.success(action === 'research' ? `${d.researched} researched, ${d.ready} ready${d.queued ? `, ${d.queued} queued for the worker` : ''}` : `${d.count} updated`)
    setSelected(new Set()); setAllMatching(false); refresh()
  }

  const pageIds = rows.map((r) => r.id)
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id))

  return (
    <div className="space-y-5 max-w-[1400px]">
      <PageHeader
        section="Prospecting"
        title="Lead Finder"
        icon={MapPinned}
        description="Find local businesses on Google Maps or OpenStreetMap, then let the system find the right email for each one: their website, the web, Hunter and verified guesses."
        actions={<>
          <FinderRunner backlog={overview?.backlog} onProgress={refresh} />
          <Button size="sm" variant="outline" onClick={() => setShowSettings(true)}><SlidersHorizontal className="h-3.5 w-3.5" />Rules</Button>
        </>}
      />

      <ServiceStrip overview={overview} onSettings={() => setShowSettings(true)} />

      <NewSearch overview={overview} onDone={(id) => { refresh(); setSearchFilter(id); setView('ALL') }} />

      {/* Funnel */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Businesses found" value={overview?.total} onClick={() => setView('ALL')} active={view === 'ALL'} />
        <Stat label="Researching" value={(st.NEW || 0) + (st.RESEARCHING || 0)} tone="sky" onClick={() => setView('RESEARCHING,NEW')} active={view === 'RESEARCHING,NEW'} />
        <Stat label="Ready to email" value={st.READY} tone="emerald" sub={overview ? `${overview.tiers.HOT || 0} hot · ${overview.tiers.WARM || 0} warm` : undefined} onClick={() => setView('READY')} active={view === 'READY'} />
        <Stat label="Email unconfirmed" value={st.EMAIL_FOUND} tone="amber" onClick={() => setView('EMAIL_FOUND')} active={view === 'EMAIL_FOUND'} />
        <Stat label="Call list" value={overview?.callList} tone="orange" sub="no email, has a phone" onClick={() => setView('CALL')} active={view === 'CALL'} />
        <Stat label="In campaigns" value={st.IN_CAMPAIGN} tone="indigo" onClick={() => setView('IN_CAMPAIGN')} active={view === 'IN_CAMPAIGN'} />
      </div>

      {/* Searches */}
      {!!searches?.length && (
        <Card>
          <button onClick={() => setShowSearches((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
            <span className="text-sm font-semibold text-slate-800">Searches <span className="font-normal text-slate-400">({searches.length})</span></span>
            {showSearches ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
          </button>
          {showSearches && (
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              {searches.slice(0, 8).map((s) => <SearchLine key={s.id} s={s} active={searchFilter === s.id} onPick={() => setSearchFilter(searchFilter === s.id ? '' : s.id)} onChanged={refresh} />)}
            </div>
          )}
        </Card>
      )}

      {/* Results */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {VIEWS.map((v) => (
              <button key={v.key} onClick={() => setView(v.key)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${view === v.key ? 'bg-ink text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                <v.icon className="h-3.5 w-3.5" />{v.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {searchFilter && (
              <button onClick={() => setSearchFilter('')} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">
                One search<X className="h-3 w-3" />
              </button>
            )}
            <select value={nicheFilter} onChange={(e) => setNicheFilter(e.target.value)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs">
              <option value="">All niches</option>
              {NICHES.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs">
              <option value="fit">Best fit</option><option value="reviews">Most reviews</option><option value="rating">Top rated</option><option value="newest">Newest</option><option value="name">Name</option>
            </select>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, city, email…" className="h-8 w-48 pl-8 text-xs" />
            </div>
            <Button size="sm" variant="outline" asChild title="Export this view as CSV">
              <a href={`/api/finder/export?${filter}`}><Download className="h-3.5 w-3.5" />CSV</a>
            </Button>
          </div>
        </div>

        {selCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-indigo-100 bg-indigo-50/70 px-4 py-2">
            <span className="text-sm text-indigo-900"><strong>{selCount.toLocaleString('en-US')}</strong> selected</span>
            {allOnPage && !allMatching && (list?.total || 0) > rows.length && (
              <button onClick={() => setAllMatching(true)} className="text-xs text-indigo-700 underline">Select all {list?.total.toLocaleString('en-US')} matching</button>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setPushIds(allMatching ? [] : [...selected])}><Megaphone className="h-3.5 w-3.5" />Add to campaign</Button>
              <Button size="sm" variant="outline" onClick={() => bulk('research')}><RefreshCw className="h-3.5 w-3.5" />Research again</Button>
              {view === 'EXCLUDED'
                ? <Button size="sm" variant="outline" onClick={() => bulk('restore')}><Undo2 className="h-3.5 w-3.5" />Restore</Button>
                : <Button size="sm" variant="outline" onClick={() => bulk('exclude')}><Ban className="h-3.5 w-3.5" />Not a fit</Button>}
              <Button size="sm" variant="ghost" onClick={() => bulk('delete')}><Trash2 className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" onClick={() => { setSelected(new Set()); setAllMatching(false) }}><X className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="w-10 px-4 py-2.5"><input type="checkbox" checked={allOnPage} onChange={() => setSelected((s) => { const n = new Set(s); if (allOnPage) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id)); return n })} /></th>
                <th className="px-2 py-2.5">Business</th>
                <th className="px-2 py-2.5">Fit</th>
                <th className="px-2 py-2.5">Best contact</th>
                <th className="px-2 py-2.5">Why them</th>
                <th className="px-4 py-2.5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setOpenId(r.id)} className={`cursor-pointer align-top transition hover:bg-slate-50 ${selected.has(r.id) || allMatching ? 'bg-indigo-50/40' : ''}`}>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={allMatching || selected.has(r.id)} onChange={() => { setAllMatching(false); setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n }) }} />
                  </td>
                  <td className="px-2 py-3 min-w-[240px]">
                    <p className="font-medium text-slate-900">{r.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                      <span>{nicheOf(r.niche)?.label || r.category}</span>
                      {(r.city || r.state) && <span>{flag(r.country)} {[r.city, r.state].filter(Boolean).join(', ')}</span>}
                      {r.rating != null && <span className="inline-flex items-center gap-0.5"><Star className="h-3 w-3 fill-amber-400 text-amber-400" />{r.rating.toFixed(1)} ({r.reviewCount})</span>}
                    </p>
                    {r.ownerName && <p className="mt-0.5 text-[11px] text-slate-600">{r.ownerName}</p>}
                  </td>
                  <td className="px-2 py-3"><FitBar score={r.fitScore} /><div className="mt-1"><TierBadge tier={r.tier} /></div></td>
                  <td className="px-2 py-3 min-w-[220px]">
                    {r.email ? (
                      <p className="flex items-center gap-1.5 text-[13px] text-slate-800">
                        {r.email.status === 'VERIFIED' ? <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : r.email.sendable ? <Mail className="h-3.5 w-3.5 shrink-0 text-sky-600" /> : <ShieldQuestion className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                        <span className="truncate max-w-[220px]">{r.email.email}</span>
                        {r.emailCount > 1 && <span className="text-[10px] text-slate-400">+{r.emailCount - 1}</span>}
                      </p>
                    ) : <p className="text-[12px] text-slate-400">{['NEW', 'RESEARCHING'].includes(r.status) ? 'Looking…' : 'No email'}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-slate-500">
                      {r.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{r.phone}</span>}
                      {r.website && <a href={r.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 hover:text-indigo-600"><Globe className="h-3 w-3" />{r.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '')}</a>}
                    </p>
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex max-w-[340px] flex-wrap gap-1">
                      {r.fitReasons.filter((x) => x.startsWith('+') && !/website|takes calls|reachable|niche|phone-driven/.test(x)).slice(0, 3).map((x) => (
                        <span key={x} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] text-slate-600">{x.replace(/^\+\d+\s*/, '')}</span>
                      ))}
                      {r.techSignals.some((t) => /competitor/.test(t)) && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10.5px] text-red-700">has a competitor</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <BizStatusBadge status={r.status} />
                    {r.lead?.campaign && <p className="mt-1 text-[10px] text-slate-400">{r.lead.campaign.name}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <div className="px-6 py-14 text-center">
              {isLoading ? <p className="text-sm text-slate-400">Loading…</p> : (
                <>
                  <MapPinned className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-2 text-sm font-medium text-slate-700">{overview?.total ? 'Nothing in this view' : 'No businesses yet'}</p>
                  <p className="text-xs text-slate-500">{overview?.total ? 'Try another tab or clear the filters.' : 'Pick a niche and a city above and press Find businesses.'}</p>
                </>
              )}
            </div>
          )}
        </div>
        {(list?.pages || 1) > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            <span>{list?.total.toLocaleString('en-US')} businesses</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span>Page {page} of {list?.pages}</span>
              <Button size="sm" variant="outline" disabled={page >= (list?.pages || 1)} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>

      <BusinessDialog id={openId} onClose={() => setOpenId(null)} onChanged={refresh} onPush={(id) => { setOpenId(null); setPushIds([id]) }} />
      <FinderPushDialog
        open={pushIds !== null}
        onOpenChange={(v) => { if (!v) setPushIds(null) }}
        ids={pushIds?.length ? pushIds : undefined}
        filter={pushIds && !pushIds.length ? filter : undefined}
        count={pushIds?.length || selCount}
        niches={pushIds?.length === 1 ? [rows.find((r) => r.id === pushIds[0])?.niche || ''] : selNiches}
        onDone={() => { setSelected(new Set()); setAllMatching(false); refresh() }}
      />
      {overview && <SettingsDialog open={showSettings} onOpenChange={setShowSettings} initial={overview.settings} onSaved={refresh} />}
    </div>
  )
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

const TONES: Record<string, string> = {
  slate: 'text-slate-900', sky: 'text-sky-700', emerald: 'text-emerald-700', amber: 'text-amber-700', orange: 'text-orange-700', indigo: 'text-indigo-700',
}

function Stat({ label, value, sub, tone = 'slate', onClick, active }: { label: string; value?: number; sub?: string; tone?: string; onClick: () => void; active: boolean }) {
  return (
    <button onClick={onClick} className={`rounded-xl border bg-white p-3.5 text-left shadow-xs transition hover:border-slate-300 ${active ? 'border-indigo-400 ring-1 ring-indigo-200' : 'border-slate-200'}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${TONES[tone]}`}>{(value ?? 0).toLocaleString('en-US')}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </button>
  )
}

function ServiceStrip({ overview, onSettings }: { overview?: Overview; onSettings: () => void }) {
  if (!overview) return null
  const s = overview.services
  const chips: Array<{ on: boolean; label: string; detail: string; hint: string }> = [
    { on: s.google, label: 'Google Maps', detail: s.google ? `${overview.google.used}/${overview.google.cap} calls this month` : 'add GOOGLE_PLACES_API_KEY', hint: 'Best coverage: ratings, reviews, hours. Free up to ~1,000 searches a month (20 businesses each); the app stops at your cap.' },
    { on: true, label: 'OpenStreetMap', detail: 'free, no key', hint: 'Always available. Fewer ratings/hours than Google, sometimes has the email.' },
    { on: !!s.search, label: 'Web search', detail: s.search ? s.search.toLowerCase() : 'add SERPER_API_KEY', hint: 'Finds emails published outside their site and the owner\'s LinkedIn title (LinkedIn itself is never scraped).' },
    { on: !!s.hunter, label: 'Hunter', detail: s.hunter ? (s.hunter.remaining != null ? `${s.hunter.remaining} credits left` : 'connected') : 'optional', hint: 'Only used when the website has nothing; a free check runs first so no credit is wasted.' },
    { on: !!s.verifier, label: 'Verifier', detail: s.verifier ? s.verifier.toLowerCase() : 'add one for more emails', hint: 'Confirms guessed addresses (owner@, info@). Without it, guesses are never used. ZeroBounce, MillionVerifier, NeverBounce or Reoon.' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <span key={c.label} title={c.hint} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${c.on ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800' : 'border-slate-200 bg-white text-slate-500'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${c.on ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          <strong className="font-medium">{c.label}</strong><span className="opacity-75">{c.detail}</span>
        </span>
      ))}
      {!overview.settings.autoResearch && (
        <button onClick={onSettings} className="inline-flex items-center gap-1 text-[11px] text-amber-700"><CircleAlert className="h-3.5 w-3.5" />Background research is off</button>
      )}
    </div>
  )
}

function NewSearch({ overview, onDone }: { overview?: Overview; onDone: (searchId: string) => void }) {
  const [niche, setNiche] = useState('dental')
  const [custom, setCustom] = useState('')
  const [locText, setLocText] = useState('')
  const [country, setCountry] = useState('US')
  const [provider, setProvider] = useState<'GOOGLE' | 'OSM' | ''>('')
  const [perPlace, setPerPlace] = useState(60)
  const [busy, setBusy] = useState(false)
  const src = provider || (overview?.services.google ? 'GOOGLE' : 'OSM')
  const locations = locText.split(/\n|;/).map((l) => l.trim()).filter((l) => l.length >= 2)
  const calls = src === 'GOOGLE' ? locations.length * Math.ceil(perPlace / 20) : 0

  async function run() {
    if (!locations.length) return toast.error('Add at least one city or area')
    if (niche === '__custom' && custom.trim().length < 3) return toast.error('Type what kind of business to look for')
    setBusy(true)
    try {
      const res = await fetch('/api/finder/searches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ niche: niche === '__custom' ? undefined : niche, query: niche === '__custom' ? custom.trim() : undefined, locations, country, provider: src, maxPerPlace: perPlace }),
      })
      const d = await res.json()
      if (!res.ok) return toast.error(d.error || 'Search failed')
      if (d.status === 'ERROR') toast.error(d.lastError || 'Search failed')
      else toast.success(`${d.added} new businesses found${d.status === 'RUNNING' ? ' so far — the rest keeps going in the background' : ''}. Researching emails now.`)
      onDone(d.id)
    } finally { setBusy(false) }
  }

  const groups = [...new Set(NICHES.map((n) => n.group))]
  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid gap-3 lg:grid-cols-[1.1fr_1.6fr_auto]">
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">What</label>
            <select value={niche} onChange={(e) => setNiche(e.target.value)} className="h-9 w-full rounded-lg border border-slate-300 px-2 text-sm">
              {groups.map((g) => (
                <optgroup key={g} label={g}>{NICHES.filter((n) => n.group === g).map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</optgroup>
              ))}
              <option value="__custom">Something else (Google only)…</option>
            </select>
            {niche === '__custom' && <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. wedding venue" className="h-9" />}
            <div className="flex gap-2">
              <select value={country} onChange={(e) => setCountry(e.target.value)} className="h-9 flex-1 rounded-lg border border-slate-300 px-2 text-sm">
                {COUNTRY_OPTIONS.map(([c, n]) => <option key={c} value={c}>{flag(c)} {n}</option>)}
              </select>
              <select value={src} onChange={(e) => setProvider(e.target.value as 'GOOGLE' | 'OSM')} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
                <option value="GOOGLE" disabled={!overview?.services.google}>Google Maps{overview?.services.google ? '' : ' (no key)'}</option>
                <option value="OSM">OpenStreetMap</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Where <span className="font-normal normal-case tracking-normal text-slate-400">one city or area per line</span>
            </label>
            <textarea value={locText} onChange={(e) => setLocText(e.target.value)} rows={3} placeholder={'Austin TX\nRound Rock TX'}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <div className="flex flex-wrap gap-1">
              {LOCATION_PRESETS.map((p) => (
                <button key={p.label} onClick={() => { setLocText(p.locations.join('\n')); setCountry(p.country) }}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 hover:border-indigo-400 hover:text-indigo-700">{p.label}</button>
              ))}
            </div>
          </div>
          <div className="flex flex-col justify-end gap-2 lg:w-52">
            <select value={perPlace} onChange={(e) => setPerPlace(Number(e.target.value))} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
              <option value={20}>Up to 20 per city</option><option value={40}>Up to 40 per city</option><option value={60}>Up to 60 per city</option>
            </select>
            <Button onClick={run} loading={busy} className="h-10"><Play className="h-4 w-4" />Find businesses</Button>
            <p className="text-[10.5px] leading-snug text-slate-400">
              {locations.length ? `${locations.length} location${locations.length === 1 ? '' : 's'}` : 'No locations yet'}
              {src === 'GOOGLE' && locations.length ? ` · up to ${calls} Google call${calls === 1 ? '' : 's'} (${Math.max(0, (overview?.google.cap || 0) - (overview?.google.used || 0))} left this month)` : ''}
              {src === 'OSM' ? ' · free' : ''}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

const SEARCH_STATUS: Record<string, string> = {
  QUEUED: 'bg-slate-100 text-slate-600', RUNNING: 'bg-sky-50 text-sky-700', DONE: 'bg-emerald-50 text-emerald-700', ERROR: 'bg-red-50 text-red-600', CANCELLED: 'bg-slate-100 text-slate-400',
}

function SearchLine({ s, active, onPick, onChanged }: { s: SearchRow; active: boolean; onPick: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState('')
  const ready = s.counts.READY || 0
  const researching = (s.counts.NEW || 0) + (s.counts.RESEARCHING || 0)
  async function act(action: string) {
    setBusy(action)
    try {
      const res = await fetch(`/api/finder/searches/${s.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      const d = await res.json()
      if (!res.ok) return toast.error(d.error || 'Failed')
      if (action !== 'cancel') toast.success(`${d.added} businesses so far`)
      onChanged()
    } finally { setBusy('') }
  }
  async function remove() {
    const alsoBusinesses = confirm('Also delete the businesses this search found (except ones already in a campaign)?\n\nOK = delete them too, Cancel = keep them')
    await fetch(`/api/finder/searches/${s.id}${alsoBusinesses ? '?businesses=1' : ''}`, { method: 'DELETE' })
    onChanged()
  }
  return (
    <div className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${active ? 'bg-indigo-50/50' : ''}`}>
      <button onClick={onPick} className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm text-slate-800">
          <span className="font-medium">{nicheOf(s.niche)?.label || `"${s.query}"`}</span>
          <span className="text-slate-500"> in {s.locations.slice(0, 3).join(', ')}{s.locations.length > 3 ? ` +${s.locations.length - 3} more` : ''}</span>
        </p>
        <p className="text-[11px] text-slate-400">
          {s.provider === 'OSM' ? 'OpenStreetMap' : 'Google'} · {fmtRelative(s.createdAt)} · {s.added} new, {s.duplicates} known, {s.filtered} filtered out
          {s.lastError && <span className="text-red-500"> · {s.lastError}</span>}
        </p>
      </button>
      <div className="flex items-center gap-3 text-[11px]">
        {researching > 0 && <span className="inline-flex items-center gap-1 text-sky-700"><Loader2 className="h-3 w-3 animate-spin" />{researching} researching</span>}
        <span className="text-emerald-700"><strong>{ready}</strong> ready</span>
        <span className={`rounded-full px-2 py-0.5 font-medium ${SEARCH_STATUS[s.status]}`}>{s.status.toLowerCase()}</span>
      </div>
      <div className="flex gap-1">
        {['RUNNING', 'QUEUED', 'ERROR'].includes(s.status) && <Button size="sm" variant="ghost" onClick={() => act('continue')} loading={busy === 'continue'} title="Continue now"><Play className="h-3.5 w-3.5" /></Button>}
        {s.status === 'DONE' && <Button size="sm" variant="ghost" onClick={() => act('rerun')} loading={busy === 'rerun'} title="Search again for new businesses"><RefreshCw className="h-3.5 w-3.5" /></Button>}
        <Button size="sm" variant="ghost" onClick={remove} title="Delete search" className="text-slate-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  )
}

function SettingsDialog({ open, onOpenChange, initial, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; initial: Settings; onSaved: () => void }) {
  const [s, setS] = useState(initial)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) setS(initial) }, [open, initial])
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }))

  async function save() {
    setBusy(true)
    try {
      const res = await fetch('/api/finder/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) })
      if (!res.ok) return toast.error((await res.json()).error || 'Could not save')
      toast.success('Rules saved'); onSaved(); onOpenChange(false)
    } finally { setBusy(false) }
  }

  const Toggle = ({ k, label, hint }: { k: 'excludeChains' | 'autoResearch' | 'useWebSearch' | 'useHunter' | 'guessEmails'; label: string; hint: string }) => (
    <label className="flex items-start gap-3 py-2">
      <input type="checkbox" checked={s[k]} onChange={(e) => set(k, e.target.checked)} className="mt-1" />
      <span><span className="block text-sm font-medium text-slate-800">{label}</span><span className="block text-xs text-slate-500">{hint}</span></span>
    </label>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Lead Finder rules</DialogTitle>
          <DialogDescription>Quality over quantity: what counts as a lead, and which paid services may be used.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Which emails count as ready</p>
            <div className="mt-2 space-y-2">
              {([['VERIFIED_OR_PUBLISHED', 'Verified, or published by the business itself', 'Addresses on their own website or map listing are made to be contacted. Guesses always need verification.'],
                ['VERIFIED_ONLY', 'Mailbox-verified only', 'Safest for deliverability; needs a verifier key to get many leads.']] as const).map(([v, l, h]) => (
                <label key={v} className={`flex gap-2.5 rounded-lg border p-3 cursor-pointer ${s.sendPolicy === v ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200'}`}>
                  <input type="radio" checked={s.sendPolicy === v} onChange={() => set('sendPolicy', v)} className="mt-1" />
                  <span><span className="block text-sm font-medium text-slate-800">{l}</span><span className="block text-xs text-slate-500">{h}</span></span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="text-xs text-slate-600">Min. reviews<Input type="number" min={0} value={s.minReviews} onChange={(e) => set('minReviews', Number(e.target.value))} className="mt-1 h-8" /></label>
            <label className="text-xs text-slate-600">Min. rating<Input type="number" min={0} max={5} step={0.1} value={s.minRating} onChange={(e) => set('minRating', Number(e.target.value))} className="mt-1 h-8" /></label>
            <label className="text-xs text-slate-600">Google calls / month<Input type="number" min={0} value={s.googleMonthlyCap} onChange={(e) => set('googleMonthlyCap', Number(e.target.value))} className="mt-1 h-8" /></label>
          </div>
          <p className="-mt-2 text-[11px] text-slate-400">Google&apos;s free allowance for these fields is 1,000 calls a month; keep the cap under it and nothing is billed.</p>
          <div className="divide-y divide-slate-100">
            <Toggle k="excludeChains" label="Skip chains and franchises" hint="Aspen Dental, Roto-Rooter, State Farm… and any website shared by 3+ listings. A local manager can't buy." />
            <Toggle k="autoResearch" label="Research in the background" hint="The 5-minute worker finishes searches and finds emails on its own." />
            <Toggle k="useWebSearch" label="Use web search" hint="Emails published outside their site, and the owner's name from LinkedIn search results (1–2 searches per business)." />
            <Toggle k="useHunter" label="Use Hunter when nothing else works" hint="Keeps the credit reserve set in Audience → Rules." />
            <Toggle k="guessEmails" label="Try likely addresses" hint="owner@, info@, office@… Only kept when a verifier confirms the mailbox exists." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} loading={busy}>Save rules</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
