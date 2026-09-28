'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Layers, Plus, Trash2, Play, ExternalLink, Users } from 'lucide-react'
import PageHeader from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PERSONAS, COUNTRIES, ENGLISH_COUNTRIES } from '@/lib/audience/taxonomy'
import { USE_CASES, BUILD_STAGES, FOR_WHOM } from '@/lib/audience/usecases'
import { flag } from '@/lib/audience/country'
import { fmtRelative } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Stats { total: number; ready: number; excluded: Array<{ stage: string; label: string; count: number }> }
interface Segment {
  id: string; name: string; filters: Record<string, string>; campaignId: string | null; autoFeed: boolean; dailyCap: number
  lastRunAt: string | null; lastAdded: number; campaign: { id: string; name: string; sendingStatus: string } | null; stats: Stats
}

const PLATFORMS: Array<[string, string]> = [['YOUTUBE', 'YouTube'], ['HN', 'Hacker News'], ['DEVTO', 'DEV']]

export default function SegmentsPage() {
  const { data: segments, mutate } = useSWR<Segment[]>('/api/audience/segments', fetcher)
  const { data: campaigns } = useSWR<Array<{ id: string; name: string; sendingStatus: string }>>('/api/campaigns', fetcher)
  const { data: channels } = useSWR<Array<{ id: string; title: string }>>('/api/audience/channels', fetcher)
  const [building, setBuilding] = useState(false)

  return (
    <div className="space-y-5 max-w-6xl">
      <PageHeader section="Audience" title="Segments" icon={Layers}
        description="Saved audiences: who they are, what they build, how fresh and how reachable. Attach one to a campaign and it feeds new ready people every day."
        actions={<Button size="sm" onClick={() => setBuilding(true)}><Plus className="h-3.5 w-3.5" />New segment</Button>} />

      {building && <Builder channels={Array.isArray(channels) ? channels : []} onDone={() => { setBuilding(false); mutate() }} onCancel={() => setBuilding(false)} />}

      {Array.isArray(segments) && !segments.length && !building && (
        <Card><CardContent className="py-12 text-center text-sm text-slate-500">
          No segments yet. Build one here, or filter the <Link href="/audience/prospects" className="text-indigo-600 hover:underline">Prospects</Link> list and click "Save as segment".
        </CardContent></Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {(Array.isArray(segments) ? segments : []).map((s) => (
          <SegmentCard key={s.id} s={s} campaigns={Array.isArray(campaigns) ? campaigns : []} onChanged={() => mutate()} />
        ))}
      </div>
    </div>
  )
}

function describe(f: Record<string, string>) {
  const parts: string[] = []
  const list = (k: string) => f[k]?.split(',').filter(Boolean) || []
  if (list('platform').length) parts.push(list('platform').map((p) => PLATFORMS.find((x) => x[0] === p)?.[1] || p).join(' / '))
  if (list('persona').length) parts.push(list('persona').map((p) => PERSONAS[p as keyof typeof PERSONAS]?.label || p).join(', '))
  if (list('useCase').length) parts.push(`building ${list('useCase').map((u) => USE_CASES[u as keyof typeof USE_CASES]?.label.toLowerCase() || u).join(' or ')}`)
  if (list('stage').length) parts.push(list('stage').map((x) => BUILD_STAGES[x as keyof typeof BUILD_STAGES] || x).join('/').toLowerCase())
  if (f.forWhom) parts.push(FOR_WHOM[f.forWhom as keyof typeof FOR_WHOM]?.toLowerCase() || f.forWhom)
  if (list('country').length) parts.push(list('country').map((c) => flag(c)).join(' '))
  if (f.minIntent) parts.push(`intent ≥ ${f.minIntent}`)
  if (f.minFit) parts.push(`fit ≥ ${f.minFit}`)
  if (f.freshDays) parts.push(`active in the last ${f.freshDays} days`)
  if (f.email === 'business') parts.push('verified business email')
  if (list('channelIds').length) parts.push(`${list('channelIds').length} channel${list('channelIds').length === 1 ? '' : 's'}`)
  return parts.join(' · ') || 'Everyone'
}

function SegmentCard({ s, campaigns, onChanged }: { s: Segment; campaigns: Array<{ id: string; name: string; sendingStatus: string }>; onChanged: () => void }) {
  const [busy, setBusy] = useState('')
  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/audience/segments/${s.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) toast.error((await res.json()).error || 'Could not save')
    onChanged()
  }
  async function feed() {
    setBusy('feed')
    try {
      const res = await fetch(`/api/audience/segments/${s.id}`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) return toast.error(d.error || 'Failed')
      toast.success(d.skipped ? `Nothing added: ${d.skipped}` : `${d.added} added to ${s.campaign?.name}`)
      onChanged()
    } finally { setBusy('') }
  }
  async function remove() {
    if (!confirm(`Delete segment "${s.name}"? People and campaigns are not affected.`)) return
    await fetch(`/api/audience/segments/${s.id}`, { method: 'DELETE' })
    onChanged()
  }
  const qs = new URLSearchParams(s.filters).toString()
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-start justify-between gap-2 text-base">
          <span>{s.name}<span className="block text-xs font-normal text-slate-500">{describe(s.filters)}</span></span>
          <Button size="sm" variant="ghost" className="text-slate-400 hover:text-red-600" onClick={remove}><Trash2 className="h-3.5 w-3.5" /></Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline gap-4">
          <span><strong className="text-2xl font-semibold tabular-nums text-slate-900">{s.stats.total.toLocaleString('en-US')}</strong> <span className="text-xs text-slate-500">people</span></span>
          <span><strong className="text-2xl font-semibold tabular-nums text-emerald-700">{s.stats.ready.toLocaleString('en-US')}</strong> <span className="text-xs text-slate-500">ready to email</span></span>
          <Link href={`/audience/prospects?${qs}`} className="ml-auto inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"><Users className="h-3.5 w-3.5" />See them<ExternalLink className="h-3 w-3" /></Link>
        </div>
        {s.stats.excluded.length > 0 && (
          <div className="rounded-lg bg-slate-50 p-2.5">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Not ready yet</p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              {s.stats.excluded.slice(0, 6).map((e) => (
                <Link key={e.stage} href={`/audience/prospects?${qs}&discovery=${e.stage}`} className="text-xs text-slate-600 hover:text-indigo-700">{e.count.toLocaleString('en-US')} {e.label}</Link>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm">
          <span className="text-xs text-slate-500">Feed into</span>
          <select value={s.campaignId || ''} onChange={(e) => patch({ campaignId: e.target.value || null })} className="h-8 max-w-[220px] rounded-lg border border-slate-300 px-2 text-xs">
            <option value="">No campaign</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}{c.sendingStatus !== 'ACTIVE' ? ` (${c.sendingStatus.toLowerCase()})` : ''}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={s.autoFeed} disabled={!s.campaignId} onChange={(e) => patch({ autoFeed: e.target.checked })} />daily, up to
          </label>
          <Input type="number" min={1} max={500} defaultValue={s.dailyCap} onBlur={(e) => Number(e.target.value) !== s.dailyCap && patch({ dailyCap: Math.max(1, Number(e.target.value) || 1) })} className="h-8 w-16 text-xs" />
          <Button size="sm" variant="outline" onClick={feed} loading={busy === 'feed'} disabled={!s.campaignId} className="ml-auto"><Play className="h-3.5 w-3.5" />Add ready now</Button>
        </div>
        {s.lastRunAt && <p className="text-[11px] text-slate-400">Last fed {fmtRelative(s.lastRunAt)} · {s.lastAdded} added that day</p>}
        {s.campaign && s.campaign.sendingStatus !== 'ACTIVE' && s.autoFeed && <p className="text-[11px] text-amber-600">The campaign isn't sending, so nothing is added until it's launched.</p>}
      </CardContent>
    </Card>
  )
}

function Chips({ options, value, onChange }: { options: Array<[string, string]>; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([k, label]) => {
        const on = value.includes(k)
        return (
          <button key={k} type="button" onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-indigo-400'}`}>{label}</button>
        )
      })}
    </div>
  )
}

function Builder({ channels, onDone, onCancel }: { channels: Array<{ id: string; title: string }>; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [f, setF] = useState({
    platform: [] as string[], channelIds: [] as string[], persona: [] as string[], useCase: [] as string[], stage: [] as string[], country: [] as string[],
    forWhom: '', minIntent: '60', minFit: '50', freshDays: '', email: 'business',
  })
  const [stats, setStats] = useState<Stats | null>(null)
  const filters = useMemo(() => {
    const out: Record<string, string> = {}
    for (const k of ['platform', 'channelIds', 'persona', 'useCase', 'stage', 'country'] as const) if (f[k].length) out[k] = f[k].join(',')
    for (const k of ['forWhom', 'minIntent', 'minFit', 'freshDays', 'email'] as const) if (f[k]) out[k] = f[k]
    return out
  }, [f])

  useEffect(() => {
    const t = setTimeout(async () => {
      const res = await fetch('/api/audience/segments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preview: filters }) })
      if (res.ok) setStats(await res.json())
    }, 400)
    return () => clearTimeout(t)
  }, [filters])

  async function save() {
    if (!name.trim()) return toast.error('Name the segment')
    const res = await fetch('/api/audience/segments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), filters }) })
    if (!res.ok) return toast.error((await res.json()).error || 'Could not save')
    toast.success('Segment saved')
    onDone()
  }
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  return (
    <Card className="border-indigo-200">
      <CardContent className="space-y-4 p-5">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Segment name, e.g. US/CA agencies building voice agents" />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Source"><Chips options={PLATFORMS} value={f.platform} onChange={(v) => set('platform', v)} /></Field>
          <Field label="Persona"><Chips options={Object.entries(PERSONAS).map(([k, v]) => [k, v.label])} value={f.persona} onChange={(v) => set('persona', v)} /></Field>
          <Field label="What they build"><Chips options={Object.entries(USE_CASES).filter(([k]) => k !== 'UNKNOWN').map(([k, v]) => [k, v.label])} value={f.useCase} onChange={(v) => set('useCase', v)} /></Field>
          <Field label="Stage"><Chips options={Object.entries(BUILD_STAGES)} value={f.stage} onChange={(v) => set('stage', v)} /></Field>
          <Field label="Country"><Chips options={ENGLISH_COUNTRIES.slice(0, 14).map((c) => [c, `${flag(c)} ${COUNTRIES[c].name}`])} value={f.country} onChange={(v) => set('country', v)} /></Field>
          <Field label="Channels (optional)">
            <select multiple value={f.channelIds} onChange={(e) => set('channelIds', [...e.target.selectedOptions].map((o) => o.value))} className="h-24 w-full rounded-lg border border-slate-300 px-2 text-xs">
              {channels.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <Field label="Builds for"><select value={f.forWhom} onChange={(e) => set('forWhom', e.target.value)} className="h-9 rounded-lg border border-slate-300 px-2 text-sm"><option value="">Anyone</option>{Object.entries(FOR_WHOM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Min. intent"><Input type="number" value={f.minIntent} onChange={(e) => set('minIntent', e.target.value)} className="h-9 w-20" /></Field>
          <Field label="Min. fit"><Input type="number" value={f.minFit} onChange={(e) => set('minFit', e.target.value)} className="h-9 w-20" /></Field>
          <Field label="Active within (days)"><Input type="number" value={f.freshDays} onChange={(e) => set('freshDays', e.target.value)} placeholder="any" className="h-9 w-24" /></Field>
          <Field label="Email"><select value={f.email} onChange={(e) => set('email', e.target.value)} className="h-9 rounded-lg border border-slate-300 px-2 text-sm"><option value="">Anyone</option><option value="business">Verified business email</option><option value="verified">Any verified email</option><option value="any">Has an email</option></select></Field>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
          <span className="text-sm text-slate-600">{stats ? <><strong className="text-slate-900">{stats.total.toLocaleString('en-US')}</strong> match · <strong className="text-emerald-700">{stats.ready.toLocaleString('en-US')}</strong> ready to email{stats.excluded[0] ? ` · most of the rest: ${stats.excluded[0].label}` : ''}</> : 'Counting…'}</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button size="sm" onClick={save}>Save segment</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>{children}</div>
}
