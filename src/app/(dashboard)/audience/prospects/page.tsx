'use client'
import { Suspense, useMemo, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { UserSearch, Search, ChevronLeft, ChevronRight, Send, RefreshCw, MailCheck, Ban, Trash2, X, Globe, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { RelevanceBadge, ProspectStatusBadge, EmailChip, Avatar } from '@/components/audience/badges'
import PushDialog from '@/components/audience/PushDialog'
import ProspectDialog from '@/components/audience/ProspectDialog'
import {
  PERSONAS, INTERESTS, PROSPECT_STATUSES, REGIONS, COUNTRIES, ENGLISH_COUNTRIES, personaLabel, interestLabel,
} from '@/lib/audience/taxonomy'
import { flag } from '@/lib/audience/country'
import PageHeader from '@/components/layout/PageHeader'

const fetcher = (url: string) => fetch(url).then(async (r) => {
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'Request failed')
  return d
})

interface Row {
  id: string; displayName: string; firstName: string | null; lastName: string | null; handle: string | null; avatarUrl: string | null; youtubeChannelId: string
  country: string | null; company: string | null; jobTitle: string | null; website: string | null; linkedIn: string | null; github: string | null
  persona: string | null; interestCategory: string | null; relevance: string; score: number; topic: string | null; status: string
  commentCount: number; consentSensitive: boolean; enrichedAt: string | null
  intentScore: number; intentEvidence: string[]; identityScore: number; ownChannelAi: boolean
  platform: string; profileUrl: string | null; countrySource: string | null; countryConfidence: number
  emails: Array<{ id: string; email: string; status: string; isPrimary: boolean; isFree: boolean }>
  lead: { id: string; status: string; campaign: { name: string } | null } | null
  comments: Array<{ text: string; video: { title: string; channel: { title: string } } }>
}
interface Page { data: Row[]; total: number; page: number; totalPages: number }

const FILTER_KEYS = ['q', 'relevance', 'persona', 'interest', 'status', 'email', 'region', 'channelId', 'videoId', 'sort', 'hideSpam', 'identified', 'minIntent', 'ownChannelAi', 'country', 'platform'] as const

const QUICK: Array<{ label: string; params: Record<string, string> }> = [
  { label: 'Ready to contact', params: { status: 'READY_TO_CONTACT' } },
  { label: 'Strong buying intent', params: { relevance: 'HIGH' } },
  { label: 'Business email', params: { email: 'business' } },
  { label: 'Identified (site / LinkedIn / company)', params: { identified: 'true', relevance: 'HIGH' } },
  { label: 'Builders with their own AI channel', params: { ownChannelAi: 'true' } },
  { label: 'High intent, not identified yet', params: { relevance: 'HIGH', identified: 'false' } },
  { label: 'In campaigns', params: { status: 'IN_CAMPAIGN' } },
]

function ProspectsInner() {
  const router = useRouter()
  const sp = useSearchParams()
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [allMatching, setAllMatching] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [push, setPush] = useState<{ ids?: string[]; filter?: string; count: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [localQ, setLocalQ] = useState(sp.get('q') || '')

  const filterString = useMemo(() => {
    const p = new URLSearchParams()
    for (const k of FILTER_KEYS) { const v = sp.get(k); if (v) p.set(k, v) }
    return p.toString()
  }, [sp])
  const { data, mutate, isLoading } = useSWR<Page>(`/api/audience/prospects?page=${page}&pageSize=50&${filterString}`, fetcher, { keepPreviousData: true })
  const { data: channels } = useSWR<Array<{ id: string; title: string }>>('/api/audience/channels', fetcher)
  const rows = data?.data ?? []
  const total = data?.total ?? 0

  function setFilter(patch: Record<string, string | null>, replace = false) {
    const p = new URLSearchParams(replace ? '' : filterString)
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k) }
    setPage(1); setSelected(new Set()); setAllMatching(false)
    router.push(`/audience/prospects${p.toString() ? `?${p}` : ''}`)
  }

  const count = allMatching ? total : selected.size
  const target = allMatching ? { filter: filterString } : { ids: [...selected] }

  async function bulk(action: string, extra: Record<string, unknown> = {}, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return
    setBusy(action)
    try {
      const res = await fetch('/api/audience/prospects/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...target, ...extra }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(d.error || 'Failed')
      if (action === 'enrich') toast.success(`Researched ${d.enriched}: ${d.websites || 0} site${d.websites === 1 ? '' : 's'} and ${d.linkedIn || 0} LinkedIn found by search, ${d.emailsFound} email${d.emailsFound === 1 ? '' : 's'}, ${d.verified || 0} verified${d.queued ? `. ${d.queued} more are queued for the background worker.` : ''}`)
      else if (action === 'verify') toast.success(`Checked ${d.checked}: ${d.verified} verified, ${d.invalid} invalid`)
      else toast.success(`Done (${d.count ?? ''})`)
      setSelected(new Set()); setAllMatching(false)
      mutate()
    } finally { setBusy(null) }
  }

  const pageAll = rows.length > 0 && rows.every((r) => selected.has(r.id))

  return (
    <div className="space-y-4 max-w-[1400px]">
      <PageHeader
        section="Audience"
        title="Prospects"
        icon={UserSearch}
        description="One row per person across YouTube and Hacker News, ranked by buying intent. Open a row for the evidence, their emails and a preview of the first email."
        actions={<Button size="sm" variant="outline" asChild><a href={`/api/audience/prospects/export?${filterString}`}><Download className="h-3.5 w-3.5" />Export CSV</a></Button>}
      />

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((qf) => {
            const on = Object.entries(qf.params).every(([k, v]) => sp.get(k) === v)
            return (
              <button key={qf.label} onClick={() => setFilter(on ? {} : qf.params, true)}
                className={`rounded-full border px-2.5 py-1 text-xs ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:border-indigo-400'}`}>{qf.label}</button>
            )
          })}
          {filterString && <button onClick={() => { setLocalQ(''); setFilter({}, true) }} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-slate-500 hover:text-slate-800"><X className="h-3 w-3" />Clear filters</button>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input value={localQ} onChange={(e) => setLocalQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setFilter({ q: localQ || null })} placeholder="Name, company, email or topic" className="pl-8" />
          </div>
          <Sel value={sp.get('relevance') || ''} onChange={(v) => setFilter({ relevance: v })} options={[['', 'Any intent'], ['HIGH', 'High intent'], ['MEDIUM', 'Medium'], ['HIGH,MEDIUM', 'High + medium'], ['LOW', 'Low'], ['SPAM', 'Spam']]} />
          <Sel value={sp.get('persona') || ''} onChange={(v) => setFilter({ persona: v })} options={[['', 'Any persona'], ...Object.entries(PERSONAS).map(([k, v]) => [k, v.label] as [string, string])]} />
          <Sel value={sp.get('interest') || ''} onChange={(v) => setFilter({ interest: v })} options={[['', 'Any interest'], ...Object.entries(INTERESTS).map(([k, v]) => [k, v.label] as [string, string])]} />
          <Sel value={sp.get('status') || ''} onChange={(v) => setFilter({ status: v })} options={[['', 'Any status'], ...Object.entries(PROSPECT_STATUSES) as Array<[string, string]>]} />
          <Sel value={sp.get('email') || ''} onChange={(v) => setFilter({ email: v })} options={[['', 'Any email'], ['business', 'Verified business email'], ['verified', 'Any verified email'], ['any', 'Has an email'], ['none', 'No email']]} />
          <Sel value={sp.get('region') || ''} onChange={(v) => setFilter({ region: v, country: null })} options={[['', 'Any region'], ...Object.entries(REGIONS) as Array<[string, string]>]} />
          <Sel value={sp.get('country') || ''} onChange={(v) => setFilter({ country: v })} options={[['', 'Any country'], ...ENGLISH_COUNTRIES.map((c) => [c, `${flag(c)} ${COUNTRIES[c].name}`] as [string, string]), ['UNKNOWN', 'Country unknown']]} />
          <Sel value={sp.get('platform') || ''} onChange={(v) => setFilter({ platform: v })} options={[['', 'All sources'], ['YOUTUBE', 'YouTube'], ['HN', 'Hacker News']]} />
          <Sel value={sp.get('channelId') || ''} onChange={(v) => setFilter({ channelId: v, videoId: null })} options={[['', 'Any source channel'], ...(Array.isArray(channels) ? channels : []).map((c) => [c.id, c.title] as [string, string])]} />
          <Sel value={sp.get('sort') || ''} onChange={(v) => setFilter({ sort: v })} options={[['', 'Highest intent'], ['recent', 'Most recent'], ['comments', 'Most comments'], ['subscribers', 'Biggest channel']]} />
        </div>
        {sp.get('videoId') && <p className="text-xs text-slate-500">Showing people from one video. <button onClick={() => setFilter({ videoId: null })} className="text-indigo-600 underline">Show all</button></p>}

        {count > 0 && (
          <div className="border-t border-slate-100 pt-3 space-y-2">
            {pageAll && !allMatching && total > rows.length && (
              <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
                All {rows.length} on this page are selected. <button onClick={() => setAllMatching(true)} className="font-semibold underline">Select all {total.toLocaleString('en-US')} matching</button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-slate-700">{count.toLocaleString('en-US')} selected</span>
              <Button size="sm" onClick={() => setPush({ ...target, count })}><Send className="h-3.5 w-3.5" />Add to campaign</Button>
              <Button size="sm" variant="outline" onClick={() => bulk('enrich')} loading={busy === 'enrich'} title="Own channel, website, web search, email finders, verification. Up to 6 right now; the rest are queued"><RefreshCw className="h-3.5 w-3.5" />Research</Button>
              <Button size="sm" variant="outline" onClick={() => bulk('verify')} loading={busy === 'verify'}><MailCheck className="h-3.5 w-3.5" />Verify emails</Button>
              <select onChange={(e) => { if (e.target.value) bulk('setRelevance', { relevance: e.target.value }); e.target.value = '' }} className="h-7 rounded-lg border border-slate-300 px-2 text-xs" defaultValue="">
                <option value="" disabled>Set relevance…</option>
                <option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option><option value="SPAM">Spam</option>
              </select>
              <Button size="sm" variant="outline" onClick={() => bulk('dnc', {}, `Never contact these ${count} people? Their emails go on the suppression list and running sequences stop.`)} loading={busy === 'dnc'}><Ban className="h-3.5 w-3.5" />Do not contact</Button>
              <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => bulk('forget', {}, `Delete ${count} people, their comments and CRM leads? Their emails stay suppressed.`)} loading={busy === 'forget'}><Trash2 className="h-3.5 w-3.5" />Delete &amp; forget</Button>
              <Button size="sm" variant="ghost" className="text-slate-400" onClick={() => { setSelected(new Set()); setAllMatching(false) }}>Clear</Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase">
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" checked={pageAll} onChange={() => { setAllMatching(false); setSelected(pageAll ? new Set() : new Set(rows.map((r) => r.id))) }} />
                </th>
                <th className="text-left px-3 py-3 font-semibold">Person</th>
                <th className="text-left px-3 py-3 font-semibold">Intent</th>
                <th className="text-left px-3 py-3 font-semibold min-w-[320px]">What they said</th>
                <th className="text-left px-3 py-3 font-semibold">Email</th>
                <th className="text-left px-3 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && !rows.length ? Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-100"><td colSpan={6} className="px-4 py-3"><div className="h-8 animate-pulse rounded bg-slate-100" /></td></tr>
              )) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-14 text-center text-slate-400">
                  No prospects {filterString ? 'match these filters' : 'yet'}. <Link href="/audience/discover" className="text-indigo-600 hover:underline">Collect comments from AI videos →</Link>
                </td></tr>
              ) : rows.map((r) => {
                const name = r.firstName ? [r.firstName, r.lastName].filter(Boolean).join(' ') : r.displayName
                const best = r.comments[0]
                return (
                  <tr key={r.id} className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${allMatching || selected.has(r.id) ? 'bg-indigo-50/40' : ''}`} onClick={() => setOpenId(r.id)}>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={allMatching || selected.has(r.id)} onChange={() => { setAllMatching(false); setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n }) }} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar src={r.avatarUrl} name={r.displayName} />
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 truncate max-w-[200px]">{name}</p>
                          <p className="text-[11px] text-slate-500 truncate max-w-[220px]">
                            {[r.jobTitle, r.company].filter(Boolean).join(' · ') || personaLabel(r.persona)}
                          </p>
                          <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                            <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold text-slate-500">{r.platform === 'HN' ? 'HN' : 'YT'}</span>
                            {r.country && <span title={`${(r.countrySource || '').toLowerCase()} · ${r.countryConfidence}% sure`}>{flag(r.country)} {COUNTRIES[r.country]?.name || r.country}{r.countryConfidence < 70 ? '?' : ''}</span>}
                            {r.website && <Globe className="h-3 w-3" />}
                            {r.linkedIn && <span>in</span>}
                            {r.github && <span>gh</span>}
                            {r.commentCount > 1 && <span>{r.commentCount} comments</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <RelevanceBadge value={r.relevance} score={r.intentScore} />
                      <p className="text-[11px] text-slate-500 mt-1">{interestLabel(r.interestCategory)}</p>
                      <p className={`text-[10px] mt-0.5 ${r.identityScore >= 40 ? 'text-emerald-700' : 'text-slate-400'}`} title="How sure we are who they are">identity {r.identityScore}</p>
                    </td>
                    <td className="px-3 py-3">
                      {r.topic && <p className="text-xs font-medium text-slate-700">about {r.topic}</p>}
                      {r.intentEvidence.filter((e) => e !== 'No buying signals').length > 0 && (
                        <div className="flex flex-wrap gap-1 my-1">
                          {r.intentEvidence.filter((e) => e !== 'No buying signals').slice(0, 3).map((e) => <span key={e} className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-800">{e}</span>)}
                        </div>
                      )}
                      {best && <p className="text-xs text-slate-500 line-clamp-2">&ldquo;{best.text}&rdquo;</p>}
                      {best && <p className="text-[10px] text-slate-400 truncate max-w-[420px]">{best.video.channel.title} · {best.video.title}</p>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-1 max-w-[220px]">
                        {[...r.emails].sort((a, b) => Number(a.isFree) - Number(b.isFree)).slice(0, 2).map((e) => (
                          <div key={e.id} className="flex items-center gap-1">
                            <EmailChip email={e.email} status={e.status} primary={e.isPrimary} />
                            <span className={`text-[9px] uppercase ${e.isFree ? 'text-amber-600' : 'text-emerald-700'}`}>{e.isFree ? 'personal' : 'business'}</span>
                          </div>
                        ))}
                        {r.emails.length > 2 && <span className="text-[10px] text-slate-400">+{r.emails.length - 2} more</span>}
                        {!r.emails.length && <span className="text-[11px] text-slate-400">{r.enrichedAt ? 'none found' : 'not researched'}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <ProspectStatusBadge status={r.status} leadStatus={r.lead?.status} />
                      {r.lead?.campaign && <p className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[150px]">{r.lead.campaign.name.replace('AI Builder — ', '')}</p>}
                      {r.consentSensitive && <p className="text-[10px] text-amber-600 mt-0.5">stricter rules</p>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {total > 0 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-sm text-slate-500">
            <span>{total.toLocaleString('en-US')} people</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <span>Page {page} of {data?.totalPages || 1}</span>
              <Button size="sm" variant="ghost" disabled={page >= (data?.totalPages || 1)} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </Card>

      <ProspectDialog id={openId} onClose={() => setOpenId(null)} onChanged={() => mutate()} onPush={(id) => setPush({ ids: [id], count: 1 })} />
      <PushDialog open={!!push} onOpenChange={(v) => !v && setPush(null)} ids={push?.ids} filter={push?.filter} count={push?.count || 0}
        onDone={() => { setSelected(new Set()); setAllMatching(false); mutate() }} />
    </div>
  )
}

function Sel({ value, onChange, options }: { value: string; onChange: (v: string | null) => void; options: Array<[string, string]> }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value || null)} className={`h-9 rounded-lg border px-2 text-sm max-w-[180px] ${value ? 'border-indigo-400 bg-indigo-50 text-indigo-800' : 'border-slate-300 text-slate-700'}`}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}

export default function ProspectsPage() {
  return <Suspense><ProspectsInner /></Suspense>
}
