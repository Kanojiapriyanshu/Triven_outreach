'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { toast } from 'sonner'
import {
  Radar, Telescope, UserSearch, Settings2, CheckCircle2, AlertTriangle, Circle, Megaphone, ExternalLink, Gauge,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import PipelineRunner from '@/components/audience/PipelineRunner'
import { fmtNum, Avatar } from '@/components/audience/badges'
import { COUNTRIES, ENGLISH_COUNTRIES, INTERESTS, PERSONAS, REGIONS, type Interest, type Persona, type Region } from '@/lib/audience/taxonomy'
import type { AudienceSettings } from '@/lib/audience/settings'
import { flag } from '@/lib/audience/country'
import PageHeader from '@/components/layout/PageHeader'

const fetcher = (url: string) => fetch(url).then(async (r) => {
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'Request failed')
  return d
})

interface Overview {
  config: { youtube: boolean; ai: boolean; verifier: string | null; search: string | null; finders: string[] }
  quota: { used: number; limit: number; left: number }
  hunter: { plan: string; remaining: number; available: number; resetDate: string | null } | null
  backlog: { videos: number; review: number; enrich: number; identity: number; finder: number; verify: number; total: number }
  funnel: Record<string, number>
  quality: { relevantPct: number | null; profilePct: number | null; emailFoundPct: number | null; verifiedPct: number | null; repeatMerged: number; invalidEmailPct: number | null; emailsTotal: number; dnc: number }
  outreach: { replyPct: number | null; interestedPct: number | null; meetingPct: number | null; wonPct: number | null }
  counts: { channels: number; videos: number }
  byInterest: Array<{ key: string; count: number }>
  byPersona: Array<{ key: string; count: number }>
  byRegion: Array<{ key: string; count: number }>
  byCountry: Array<{ key: string; count: number }>
  byPlatform: Array<{ key: string; count: number }>
  sources: Array<{ id: string; title: string; handle: string | null; thumbnailUrl: string | null; subscriberCount: number; videos: number; comments: number; prospects: number; relevant: number; withEmail: number; verified: number; contacted: number; replied: number; interested: number; meetings: number }>
}
interface PresetCampaign { key: string; name: string; personas: string[]; id: string | null; sendingStatus: string | null; leads: number; templates: number }

const FUNNEL: Array<{ key: string; label: string; hint?: string }> = [
  { key: 'comments', label: 'Comments collected' },
  { key: 'prospects', label: 'People (deduplicated)' },
  { key: 'relevant', label: 'Real interest', hint: 'high + medium intent' },
  { key: 'high', label: 'Strong buying intent' },
  { key: 'withEmail', label: 'Email found' },
  { key: 'verified', label: 'Email verified' },
  { key: 'ready', label: 'Ready to contact' },
  { key: 'inCampaign', label: 'In a campaign' },
  { key: 'contacted', label: 'Emailed' },
  { key: 'followUps', label: 'Followed up' },
  { key: 'replied', label: 'Replied' },
  { key: 'interested', label: 'Interested' },
  { key: 'meetings', label: 'Meetings' },
  { key: 'won', label: 'Customers' },
]

function pct(v: number | null) {
  return v === null ? '–' : `${v}%`
}

export default function AudienceOverviewPage() {
  const { data, mutate } = useSWR<Overview>('/api/audience/overview', fetcher, { refreshInterval: 30_000 })
  const { data: presets, mutate: mutatePresets } = useSWR<PresetCampaign[]>('/api/audience/campaigns', fetcher)
  const { data: outreach } = useSWR<{ builderUrl?: string; senderAddress?: string }>('/api/settings', fetcher)
  const [showSettings, setShowSettings] = useState(false)
  const [creating, setCreating] = useState(false)

  const f = data?.funnel || {}
  const top = Math.max(1, f.comments || 0)
  const presetsMissing = (presets || []).filter((p) => !p.id).length

  async function createCampaigns() {
    setCreating(true)
    try {
      const res = await fetch('/api/audience/campaigns', { method: 'POST' })
      const d = await res.json()
      if (!res.ok) return toast.error(d.error || 'Could not create campaigns')
      toast.success(d.created ? `Created ${d.created} campaign${d.created === 1 ? '' : 's'} with their email sequences` : 'All campaigns already exist')
      mutatePresets()
    } finally { setCreating(false) }
  }

  const setup = data ? [
    { ok: data.config.youtube, title: 'YouTube Data API key', need: true, body: 'Add YOUTUBE_API_KEY to the environment (Google Cloud → APIs → YouTube Data API v3 → Credentials). Free quota: 10,000 units a day.' },
    { ok: !!data.config.verifier, title: data.config.verifier ? `Email verifier: ${data.config.verifier.toLowerCase()}` : 'Email verifier', need: true, body: 'Mailbox-level checks need a provider key: ZEROBOUNCE_API_KEY, NEVERBOUNCE_API_KEY, MILLIONVERIFIER_API_KEY or REOON_API_KEY. Without one, emails stay "unknown" (only the domain is checked).' },
    { ok: presetsMissing === 0 && !!presets, title: 'AI Builder campaigns', need: true, body: 'Five campaigns (Founders, Developers, Agencies, Consultants, Enthusiasts), each with its own 4-email sequence.' },
    { ok: !!outreach?.senderAddress, title: 'Postal address in the email footer', need: true, body: 'Required in commercial email to the US, Canada and Australia. Set it in Settings.' },
    { ok: data.config.ai, title: 'AI review (optional)', need: false, body: 'ANTHROPIC_API_KEY lets Claude re-check shortlisted people and write a one-line personal opener from their comment.' },
    { ok: !!outreach?.builderUrl, title: 'Try-it link (optional)', need: false, body: 'Used in the last follow-up. Without it, people are asked to reply for access.' },
    { ok: !!data.config.search, title: data.config.search ? `Identity search: ${data.config.search.toLowerCase()}` : 'Identity search (recommended)', need: false, body: 'BRAVE_SEARCH_API_KEY or SERPER_API_KEY. Finds the website and LinkedIn of high-intent people whose YouTube profile shows neither, so the email finders know who to look for.' },
    { ok: data.config.finders.length > 0, title: data.config.finders.length ? `Email finders: ${data.config.finders.map((f) => f.toLowerCase()).join(' + ')}` : 'Email finders (recommended)', need: false, body: 'HUNTER_API_KEY and/or APOLLO_API_KEY. Once we know who someone is and where they work, these return their business email. This is where most business emails come from.' },
  ] : []

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader
        section="Audience"
        title="Audience overview"
        icon={Radar}
        description="People who discuss AI on YouTube and Hacker News, scored for buying intent, identified, and verified before anyone emails them. The pipeline also runs by itself every 5 minutes."
        actions={<>
          <Button size="sm" variant="outline" asChild><Link href="/audience/discover"><Telescope className="h-3.5 w-3.5" />Discover</Link></Button>
          <Button size="sm" variant="outline" asChild><Link href="/audience/prospects"><UserSearch className="h-3.5 w-3.5" />Prospects</Link></Button>
          <Button size="sm" variant="outline" onClick={() => setShowSettings(true)}><Settings2 className="h-4 w-4" />Rules</Button>
        </>}
      />

      <Card>
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
          <PipelineRunner backlog={data?.backlog} onProgress={() => mutate()} />
          {data && (
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <span>Waiting: {data.backlog.videos} video{data.backlog.videos === 1 ? '' : 's'} to read · {data.backlog.review} to review · {data.backlog.enrich} to research · {data.backlog.identity} to identify · {data.backlog.finder} for email finders · {data.backlog.verify} emails to verify</span>
              {data.hunter && (
                <span title={`Hunter ${data.hunter.plan} plan${data.hunter.resetDate ? `, resets ${data.hunter.resetDate}` : ''}. Lookups stop at your reserve.`}>
                  Hunter credits {data.hunter.remaining}/{data.hunter.available}{data.hunter.resetDate ? ` · resets ${data.hunter.resetDate}` : ''}
                </span>
              )}
              <span className="flex items-center gap-1.5" title="Resets at midnight Pacific time">
                <Gauge className="h-3.5 w-3.5" />YouTube quota {fmtNum(data.quota.used)}/{fmtNum(data.quota.limit)}
                <span className="inline-block h-1.5 w-20 rounded-full bg-slate-100 overflow-hidden">
                  <span className={`block h-full ${data.quota.used / data.quota.limit > 0.85 ? 'bg-red-500' : 'bg-indigo-500'}`} style={{ width: `${Math.min(100, (data.quota.used / data.quota.limit) * 100)}%` }} />
                </span>
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {data && setup.some((s) => !s.ok && s.need) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Setup</CardTitle>
            <CardDescription>What the system needs before it can fill campaigns on its own.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2">
            {setup.map((s) => (
              <div key={s.title} className="flex gap-2.5 rounded-lg border border-slate-100 p-3">
                {s.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" /> : s.need ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" /> : <Circle className="h-4 w-4 shrink-0 text-slate-300 mt-0.5" />}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{s.title}</p>
                  {!s.ok && <p className="text-xs text-slate-500 mt-0.5">{s.body}</p>}
                  {!s.ok && s.title === 'AI Builder campaigns' && (
                    <Button size="sm" className="mt-2" onClick={createCampaigns} loading={creating}><Megaphone className="h-3.5 w-3.5" />Create the 5 campaigns</Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Funnel */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle>Audience funnel</CardTitle>
            <CardDescription>From public comments to customers. Every step keeps the reason each person was picked.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {FUNNEL.map((s, i) => {
              const v = f[s.key] || 0
              const prev = i > 0 ? f[FUNNEL[i - 1].key] || 0 : 0
              return (
                <div key={s.key} className="flex items-center gap-3 text-sm">
                  <span className="w-40 shrink-0 text-slate-600">{s.label}</span>
                  <div className="flex-1 h-5 rounded bg-slate-50 overflow-hidden">
                    <div className={`h-full rounded ${i < 7 ? 'bg-indigo-500/80' : 'bg-emerald-500/80'}`} style={{ width: `${Math.max(v ? 1.5 : 0, Math.sqrt(v / top) * 100)}%` }} />
                  </div>
                  <span className="w-16 text-right font-semibold tabular-nums text-slate-900">{v.toLocaleString('en-US')}</span>
                  <span className="w-12 text-right text-xs text-slate-400 tabular-nums">{i > 0 && prev ? `${Math.round((v / prev) * 100)}%` : ''}</span>
                </div>
              )
            })}
            <p className="text-[11px] text-slate-400 pt-1">Bar length uses a square-root scale so the small end of the funnel stays visible. The % is the step-to-step conversion.</p>
          </CardContent>
        </Card>

        {/* Quality + outreach */}
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <CardHeader className="pb-2"><CardTitle>Data quality</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {[
                { label: 'Relevant people', value: pct(data?.quality.relevantPct ?? null), hint: 'of everyone collected' },
                { label: 'Profile identified', value: pct(data?.quality.profilePct ?? null), hint: 'site, LinkedIn, GitHub or company' },
                { label: 'Email found', value: pct(data?.quality.emailFoundPct ?? null), hint: 'of people researched' },
                { label: 'Verified', value: pct(data?.quality.verifiedPct ?? null), hint: 'of people with an email' },
                { label: 'Repeat comments merged', value: fmtNum(data?.quality.repeatMerged ?? 0), hint: 'same person, one record' },
                { label: 'Invalid-email rate', value: pct(data?.quality.invalidEmailPct ?? null), hint: `${fmtNum(data?.quality.emailsTotal ?? 0)} addresses checked` },
              ].map((m) => (
                <div key={m.label} className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-[11px] text-slate-500">{m.label}</p>
                  <p className="text-lg font-semibold text-slate-900">{m.value}</p>
                  <p className="text-[10px] text-slate-400">{m.hint}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle>Outreach</CardTitle><CardDescription>Of people emailed</CardDescription></CardHeader>
            <CardContent className="grid grid-cols-4 gap-2">
              {[
                { label: 'Replied', value: data?.outreach.replyPct ?? null },
                { label: 'Interested', value: data?.outreach.interestedPct ?? null },
                { label: 'Meetings', value: data?.outreach.meetingPct ?? null },
                { label: 'Customers', value: data?.outreach.wonPct ?? null },
              ].map((m) => (
                <div key={m.label} className="rounded-lg bg-slate-50 px-2 py-2 text-center">
                  <p className="text-[11px] text-slate-500">{m.label}</p>
                  <p className="text-base font-semibold text-slate-900">{pct(m.value)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Breakdown */}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <Breakdown title="By interest" rows={(data?.byInterest || []).map((r) => ({ label: INTERESTS[r.key as Interest]?.label || 'Not clear', count: r.count, href: `/audience/prospects?interest=${r.key}` }))} />
        <Breakdown title="By persona" rows={(data?.byPersona || []).map((r) => ({ label: PERSONAS[r.key as Persona]?.label || 'Not clear yet', count: r.count, href: `/audience/prospects?persona=${r.key}` }))} />
        <Breakdown title="By country" rows={(data?.byCountry || []).map((r) => ({ label: r.key === 'UNKNOWN' ? 'Not known yet' : `${flag(r.key)} ${COUNTRIES[r.key]?.name || r.key}`, count: r.count, href: `/audience/prospects?country=${r.key}` }))} />
        <Breakdown title="By region" rows={(data?.byRegion || []).map((r) => ({ label: REGIONS[r.key as Region] || 'Unknown', count: r.count, href: r.key !== 'UNKNOWN' ? `/audience/prospects?region=${r.key}` : undefined }))} />
        <Breakdown title="By source" rows={(data?.byPlatform || []).map((r) => ({ label: r.key === 'HN' ? 'Hacker News' : 'YouTube', count: r.count, href: `/audience/prospects?platform=${r.key}` }))} />
      </div>

      {/* Sources */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle>Source performance</CardTitle>
          <CardDescription>Which channels&apos; audiences are worth mining. Relevant people and replies matter more than raw comment counts.</CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-y border-slate-200 text-xs text-slate-500 uppercase">
                <th className="text-left px-4 py-2.5 font-semibold">Channel</th>
                {['Videos', 'Comments', 'People', 'Relevant', 'Email', 'Verified', 'Emailed', 'Replied', 'Interested', 'Meetings'].map((h) => (
                  <th key={h} className="text-right px-3 py-2.5 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.sources || []).length === 0 && (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-slate-400">No channels yet. <Link href="/audience/discover" className="text-indigo-600 hover:underline">Find AI videos to start →</Link></td></tr>
              )}
              {(data?.sources || []).map((s) => (
                <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link href={`/audience/prospects?channelId=${s.id}`} className="flex items-center gap-2 hover:text-indigo-600">
                      <Avatar src={s.thumbnailUrl} name={s.title} size={24} />
                      <span className="font-medium text-slate-800">{s.title}</span>
                      <span className="text-xs text-slate-400">{fmtNum(s.subscriberCount)} subs</span>
                    </Link>
                  </td>
                  {[s.videos, s.comments, s.prospects, s.relevant, s.withEmail, s.verified, s.contacted, s.replied, s.interested, s.meetings].map((v, i) => (
                    <td key={i} className={`text-right px-3 py-2.5 tabular-nums ${i === 3 ? 'font-semibold text-slate-900' : i >= 7 && v ? 'font-semibold text-emerald-700' : 'text-slate-600'}`}>{v ? v.toLocaleString('en-US') : '–'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Campaigns */}
      <Card>
        <CardHeader className="pb-3 flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>AI Builder campaigns</CardTitle>
            <CardDescription>Prospects are routed by persona. Each campaign has its own sequence: comment-based intro → use case → examples → try it.</CardDescription>
          </div>
          {presetsMissing > 0 && <Button size="sm" onClick={createCampaigns} loading={creating}><Megaphone className="h-3.5 w-3.5" />Create {presetsMissing} missing</Button>}
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {(presets || []).map((p) => (
            <div key={p.key} className="rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-semibold text-slate-800">{p.name.replace('AI Builder — ', '')}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{p.personas.map((x) => PERSONAS[x as Persona]?.label).join(', ')}</p>
              {p.id ? (
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-slate-600">{p.leads} lead{p.leads === 1 ? '' : 's'} · {p.sendingStatus === 'ACTIVE' ? <span className="text-emerald-700 font-medium">sending</span> : p.sendingStatus?.toLowerCase()}</span>
                  <Link href="/campaigns" className="text-indigo-600 hover:underline inline-flex items-center gap-0.5">Open<ExternalLink className="h-3 w-3" /></Link>
                </div>
              ) : <p className="mt-2 text-xs text-amber-600">Not created yet</p>}
            </div>
          ))}
        </CardContent>
      </Card>

      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} onSaved={() => mutate()} />
    </div>
  )
}

function Breakdown({ title, rows }: { title: string; rows: Array<{ label: string; count: number; href?: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle><CardDescription className="text-xs">Relevant people only</CardDescription></CardHeader>
      <CardContent className="space-y-1.5">
        {rows.length === 0 && <p className="text-xs text-slate-400">Nothing yet</p>}
        {[...rows].sort((a, b) => b.count - a.count).map((r) => {
          const inner = (
            <div className="flex items-center gap-2 text-xs">
              <span className="w-40 shrink-0 truncate text-slate-600">{r.label}</span>
              <div className="flex-1 h-3 rounded bg-slate-50 overflow-hidden"><div className="h-full rounded bg-indigo-400" style={{ width: `${(r.count / max) * 100}%` }} /></div>
              <span className="w-10 text-right tabular-nums font-medium text-slate-800">{r.count.toLocaleString('en-US')}</span>
            </div>
          )
          return r.href ? <Link key={r.label} href={r.href} className="block hover:opacity-80">{inner}</Link> : <div key={r.label}>{inner}</div>
        })}
      </CardContent>
    </Card>
  )
}

function SettingsDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const { data, mutate } = useSWR<AudienceSettings>(open ? '/api/audience/settings' : null, fetcher)
  const [form, setForm] = useState<AudienceSettings | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (data && 'sendPolicy' in data) setForm(data) }, [data])

  async function save() {
    if (!form) return
    setSaving(true)
    try {
      const res = await fetch('/api/audience/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const d = await res.json()
      if (!res.ok) return toast.error(d.error || 'Could not save')
      toast.success(d.reevaluated ? `Saved. ${d.reevaluated} people re-checked against the new rules.` : 'Saved')
      mutate(); onSaved(); onOpenChange(false)
    } finally { setSaving(false) }
  }

  const set = <K extends keyof AudienceSettings>(k: K, v: AudienceSettings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))
  const toggleCountry = (c: string) => form && set('countries', form.countries.includes(c) ? form.countries.filter((x) => x !== c) : [...form.countries, c])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Audience rules</DialogTitle>
          <DialogDescription>What makes someone &quot;ready to contact&quot;, and how much the pipeline collects.</DialogDescription>
        </DialogHeader>
        {!form ? <div className="h-40 animate-pulse rounded-lg bg-slate-50" /> : (
          <div className="space-y-5">
            <div>
              <Label>Which emails can be contacted</Label>
              <div className="mt-2 space-y-2">
                {([
                  ['VERIFIED_ONLY', 'Verified only (recommended)', 'Only addresses a verification provider confirmed as deliverable.'],
                  ['VERIFIED_OR_PUBLISHED', 'Verified, or published by the person', 'Also addresses the person published themselves (channel bio, own website, GitHub) on a domain that receives mail. Useful before you add a verifier; bounces are more likely.'],
                ] as const).map(([v, t, d]) => (
                  <label key={v} className={`flex gap-2.5 rounded-lg border p-3 cursor-pointer ${form.sendPolicy === v ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200'}`}>
                    <input type="radio" checked={form.sendPolicy === v} onChange={() => set('sendPolicy', v)} className="mt-1" />
                    <span><span className="text-sm font-medium text-slate-800">{t}</span><span className="block text-xs text-slate-500">{d}</span></span>
                  </label>
                ))}
              </div>
            </div>

            <label className="flex gap-2.5 items-start">
              <input type="checkbox" checked={form.strictRegions} onChange={(e) => set('strictRegions', e.target.checked)} className="mt-1" />
              <span>
                <span className="text-sm font-medium text-slate-800">Stricter rules for the EU, UK, Canada, Australia and New Zealand</span>
                <span className="block text-xs text-slate-500">
                  Anti-spam laws there (GDPR/PECR, CASL, Spam Act, UEMA) are stricter about unsolicited email. People from these countries are only contacted on an address they published themselves; guessed addresses are never used. This is a safeguard, not legal advice.
                </span>
              </span>
            </label>

            <div className="rounded-lg border border-slate-200 p-3 space-y-3">
              <p className="text-sm font-semibold text-slate-800">Who counts as a real prospect</p>
              <label className="flex gap-2.5 items-start">
                <input type="checkbox" checked={form.businessEmailsOnly} onChange={(e) => set('businessEmailsOnly', e.target.checked)} className="mt-1" />
                <span>
                  <span className="text-sm font-medium text-slate-800">Business emails only</span>
                  <span className="block text-xs text-slate-500">Personal inboxes (gmail, outlook…) are skipped, unless the person published that address for contact (channel bio, their video descriptions, their site) and shows strong intent.</span>
                </span>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Email people with</Label>
                  <select value={form.outreachFrom} onChange={(e) => set('outreachFrom', e.target.value as 'HIGH' | 'MEDIUM')} className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 text-sm">
                    <option value="HIGH">Strong buying intent only (recommended)</option>
                    <option value="MEDIUM">Medium intent and up</option>
                  </select>
                </div>
                <div>
                  <Label>Minimum identity</Label>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Input type="number" min={0} max={100} step={5} value={form.minIdentity} onChange={(e) => set('minIdentity', Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="w-20" />
                    <span className="text-xs text-slate-500">/100 · 40 = a confirmed site, or name + company</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-5">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.useWebSearch} onChange={(e) => set('useWebSearch', e.target.checked)} />Identity search (web search API)</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.useFinders} onChange={(e) => set('useFinders', e.target.checked)} />Email finders (Hunter / Apollo)</label>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                Keep
                <Input type="number" min={0} value={form.hunterReserve} onChange={(e) => set('hunterReserve', Math.max(0, Number(e.target.value) || 0))} className="h-8 w-20" />
                Hunter credits untouched each month (for your own lookups). The pipeline stops using Hunter at this number.
              </div>
            </div>

            <div>
              <Label>Countries</Label>
              <p className="text-xs text-slate-500 mt-0.5">None selected = any English-speaking audience. Most YouTube profiles have no country; those are judged by the language of their comments.</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ENGLISH_COUNTRIES.map((c) => (
                  <button key={c} type="button" onClick={() => toggleCountry(c)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${form.countries.includes(c) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300'}`}>
                    {COUNTRIES[c].name}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label>Research people rated</Label>
                <select value={form.enrichFrom} onChange={(e) => set('enrichFrom', e.target.value as 'HIGH' | 'MEDIUM')} className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 text-sm">
                  <option value="MEDIUM">Medium and high</option>
                  <option value="HIGH">High only</option>
                </select>
              </div>
              <div>
                <Label>Comments per video</Label>
                <Input type="number" min={100} max={20000} step={100} value={form.maxCommentsPerVideo} onChange={(e) => set('maxCommentsPerVideo', Math.max(100, Number(e.target.value) || 100))} className="mt-1" />
                <p className="text-[11px] text-slate-400 mt-0.5">100 comments = 1 quota unit</p>
              </div>
              <div>
                <Label>Delete irrelevant data after</Label>
                <div className="flex items-center gap-1.5 mt-1">
                  <Input type="number" min={7} max={365} value={form.retentionDays} onChange={(e) => set('retentionDays', Math.max(7, Number(e.target.value) || 30))} className="w-20" />
                  <span className="text-sm text-slate-500">days</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.autoRun} onChange={(e) => set('autoRun', e.target.checked)} />Run automatically every 5 minutes</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.useAi} onChange={(e) => set('useAi', e.target.checked)} />Use the AI review (when a key is set)</label>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={!form}>Save rules</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
