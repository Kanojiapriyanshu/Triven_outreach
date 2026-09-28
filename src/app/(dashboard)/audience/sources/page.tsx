'use client'
import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { toast } from 'sonner'
import { BarChart3, RefreshCw, Play, Pause, ExternalLink, Sparkles, ShieldAlert, TrendingUp } from 'lucide-react'
import PageHeader from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { PERSONAS, COUNTRIES } from '@/lib/audience/taxonomy'
import { useCaseLabel } from '@/lib/audience/usecases'
import { videoUrl, PLATFORM_LABEL } from '@/lib/audience/links'
import { flag } from '@/lib/audience/country'
import { fmtCurrency, fmtRelative } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Snap { comments: number; flagged: number; people: number; qualified: number; qra: number; contacted: number; replied: number; positive: number; meetings: number; won: number; revenue: number; yield: number }
interface ChannelRow extends Snap {
  containerId: string; qra7: number | null
  channel: { id: string; title: string; thumbnailUrl: string | null; platform: string; subscriberCount: number; yieldScore: number; autoPaused: boolean; pausedReason: string | null; qualityFlagged: number } | null
}
interface Rec { id: string; title: string; score: number; commentCount: number; publishedAt: string | null; platform: string; youtubeVideoId: string; url: string | null; channel: { title: string }; why: string }
interface Data { date: string | null; channels: ChannelRow[]; totals: Snap; recommendations: Rec[] }

const fmt = (n: number) => n.toLocaleString('en-US')
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '–')

export default function SourcesPage() {
  const { data, mutate } = useSWR<Data>('/api/audience/sources', fetcher)
  const [open, setOpen] = useState<ChannelRow | null>(null)
  const [busy, setBusy] = useState('')
  const max = Math.max(1, ...(data?.channels || []).map((c) => c.yield))

  async function act(body: Record<string, unknown>, label: string, msg: string) {
    setBusy(label)
    try {
      const res = await fetch('/api/audience/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(d.error || 'Failed')
      toast.success(typeof msg === 'string' ? msg : 'Done')
      mutate()
    } finally { setBusy('') }
  }

  return (
    <div className="space-y-5 max-w-[1400px]">
      <PageHeader section="Audience" title="Sources" icon={BarChart3}
        description="Which channels and videos produce reachable people, replies, meetings and revenue. Collection and research budgets follow the yield: strong sources get read first, dead ones pause themselves."
        actions={<Button size="sm" variant="outline" onClick={() => act({ action: 'snapshot' }, 'snap', 'Numbers refreshed')} loading={busy === 'snap'}><RefreshCw className="h-3.5 w-3.5" />Refresh numbers</Button>} />

      {data?.totals && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {([['Comments', data.totals.comments], ['People', data.totals.people], ['Qualified', data.totals.qualified], ['Reachable (QRA)', data.totals.qra], ['Contacted', data.totals.contacted], ['Replied', data.totals.replied], ['Meetings', data.totals.meetings]] as const).map(([l, v]) => (
            <Card key={l}><CardContent className="p-3"><p className="text-[11px] text-slate-500">{l}</p><p className="text-xl font-semibold tabular-nums text-slate-900">{fmt(v)}</p></CardContent></Card>
          ))}
          <Card><CardContent className="p-3"><p className="text-[11px] text-slate-500">Revenue</p><p className="text-xl font-semibold tabular-nums text-emerald-700">{fmtCurrency(data.totals.revenue)}</p></CardContent></Card>
        </div>
      )}

      {!!data?.recommendations.length && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-indigo-600" />Collect next</span>
              <Button size="sm" onClick={() => act({ action: 'queue', videoIds: data.recommendations.map((r) => r.id) }, 'queue', `${data.recommendations.length} queued for collection`)} loading={busy === 'queue'}><Play className="h-3.5 w-3.5" />Collect all</Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-x-6 gap-y-1.5 md:grid-cols-2">
            {data.recommendations.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-sm">
                <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-500">{PLATFORM_LABEL[r.platform] || r.platform}</span>
                <a href={videoUrl(r.platform, r.youtubeVideoId, r.url)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-slate-800 hover:text-indigo-600">{r.title}</a>
                <span className="shrink-0 text-[11px] text-slate-400">{r.channel.title} · {r.why}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5">Source</th>
                <th className="px-2 py-2.5 text-right">Comments</th>
                <th className="px-2 py-2.5 text-right">People</th>
                <th className="px-2 py-2.5 text-right">Qualified</th>
                <th className="px-2 py-2.5 text-right" title="Qualified reachable audience: intent ≥ 60, fit ≥ 60, reach ≥ 80">QRA</th>
                <th className="px-2 py-2.5 text-right">Contacted</th>
                <th className="px-2 py-2.5 text-right">Replies</th>
                <th className="px-2 py-2.5 text-right">Meetings</th>
                <th className="px-2 py-2.5 text-right">Revenue</th>
                <th className="px-4 py-2.5" title="QRA per 1,000 comments (+ meetings per 100 contacted once 50+ were contacted)">Yield</th>
                <th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.channels || []).map((r) => (
                <tr key={r.containerId} onClick={() => setOpen(r)} className={`cursor-pointer hover:bg-slate-50 ${r.channel?.autoPaused ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-900">{r.channel?.title}</p>
                    <p className="flex items-center gap-2 text-[11px] text-slate-400">
                      {PLATFORM_LABEL[r.channel?.platform || ''] || r.channel?.platform}
                      {r.channel?.autoPaused && <span className="text-amber-600">paused: {r.channel.pausedReason}</span>}
                      {(r.channel?.qualityFlagged || 0) >= 0.1 && <span className="flex items-center gap-0.5 text-red-600"><ShieldAlert className="h-3 w-3" />{Math.round((r.channel?.qualityFlagged || 0) * 100)}% coordinated</span>}
                    </p>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-600">{fmt(r.comments)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-600">{fmt(r.people)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmt(r.qualified)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums font-semibold text-emerald-700">
                    {fmt(r.qra)}{r.qra7 !== null && r.qra > r.qra7 && <span className="ml-1 text-[10px] font-normal text-emerald-600">+{r.qra - r.qra7}</span>}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmt(r.contacted)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmt(r.replied)}<span className="ml-1 text-[10px] text-slate-400">{pct(r.replied, r.contacted)}</span></td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmt(r.meetings)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{r.revenue ? fmtCurrency(r.revenue) : '–'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-20 rounded-full bg-slate-100"><span className="block h-full rounded-full bg-indigo-500" style={{ width: `${(100 * r.yield) / max}%` }} /></span>
                      <span className="w-10 text-right text-xs tabular-nums text-slate-700">{r.yield.toFixed(1)}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                    {r.channel && (r.channel.autoPaused
                      ? <Button size="sm" variant="ghost" title="Resume collecting" onClick={() => act({ action: 'resume', channelId: r.channel!.id }, r.containerId, 'Resumed')}><Play className="h-3.5 w-3.5" /></Button>
                      : <Button size="sm" variant="ghost" title="Pause this source" onClick={() => act({ action: 'pause', channelId: r.channel!.id }, r.containerId, 'Paused')}><Pause className="h-3.5 w-3.5" /></Button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !data.channels.length && <p className="px-6 py-12 text-center text-sm text-slate-400">No collected sources yet. <Link href="/audience/discover" className="text-indigo-600 hover:underline">Find some in Discover</Link>.</p>}
        </div>
        {data?.date && <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">Numbers from {fmtRelative(data.date)} · refreshed nightly · replies, meetings and revenue are credited to the source where the person was first found</p>}
      </Card>

      <ChannelDialog row={open} onClose={() => setOpen(null)} />
    </div>
  )
}

interface ChannelDetail {
  videos: Array<Snap & { contentId: string; title: string | null; meta: { platform: string; url: string | null; youtubeVideoId: string; publishedAt: string | null } | null }>
  mix: { persona: Array<[string, number]>; useCase: Array<[string, number]>; country: Array<[string, number]> }
}

function ChannelDialog({ row, onClose }: { row: ChannelRow | null; onClose: () => void }) {
  const { data } = useSWR<ChannelDetail>(row?.channel ? `/api/audience/sources?channel=${row.channel.id}` : null, fetcher)
  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-indigo-600" />{row?.channel?.title}</DialogTitle>
          <DialogDescription>{row && `${fmt(row.comments)} comments → ${fmt(row.people)} people → ${fmt(row.qualified)} qualified → ${fmt(row.qra)} reachable → ${fmt(row.contacted)} contacted → ${fmt(row.replied)} replied → ${fmt(row.meetings)} meetings${row.revenue ? ` → ${fmtCurrency(row.revenue)}` : ''}`}</DialogDescription>
        </DialogHeader>
        {!data ? <div className="h-40 animate-pulse rounded-lg bg-slate-50" /> : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Mix title="Personas" rows={data.mix.persona.map(([k, v]) => [PERSONAS[k as keyof typeof PERSONAS]?.label || 'Not clear', v])} />
              <Mix title="What they build" rows={data.mix.useCase.map(([k, v]) => [k === 'UNKNOWN' ? 'Not clear' : useCaseLabel(k), v])} />
              <Mix title="Countries" rows={data.mix.country.map(([k, v]) => [k === 'UNKNOWN' ? 'Not known' : `${flag(k)} ${COUNTRIES[k]?.name || k}`, v])} />
            </div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500"><th className="py-1.5">Video / thread</th><th className="px-2 text-right">Comments</th><th className="px-2 text-right">Qualified</th><th className="px-2 text-right">QRA</th><th className="px-2 text-right">Replies</th><th className="px-2 text-right">Yield</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.videos.map((v) => (
                  <tr key={v.contentId}>
                    <td className="py-1.5 pr-2">
                      {v.meta ? <a href={videoUrl(v.meta.platform, v.meta.youtubeVideoId, v.meta.url)} target="_blank" rel="noreferrer" className="line-clamp-1 text-slate-800 hover:text-indigo-600">{v.title} <ExternalLink className="inline h-3 w-3" /></a> : <span className="line-clamp-1">{v.title}</span>}
                    </td>
                    <td className="px-2 text-right tabular-nums text-slate-600">{fmt(v.comments)}</td>
                    <td className="px-2 text-right tabular-nums">{fmt(v.qualified)}</td>
                    <td className="px-2 text-right tabular-nums font-semibold text-emerald-700">{fmt(v.qra)}</td>
                    <td className="px-2 text-right tabular-nums">{fmt(v.replied)}</td>
                    <td className="px-2 text-right tabular-nums">{v.yield.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {row?.channel && <Link href={`/audience/prospects?channelId=${row.channel.id}&sort=opportunity`} className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">See the people from this source <ExternalLink className="h-3.5 w-3.5" /></Link>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Mix({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  const max = Math.max(1, ...rows.map((r) => r[1]))
  return (
    <div className="rounded-lg border border-slate-200 p-2.5">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[1fr_60px_28px] items-center gap-1.5 text-xs">
          <span className="truncate text-slate-700">{k}</span>
          <span className="h-1.5 rounded-full bg-slate-100"><span className="block h-full rounded-full bg-indigo-400" style={{ width: `${(100 * v) / max}%` }} /></span>
          <span className="text-right tabular-nums text-slate-500">{v}</span>
        </div>
      ))}
      {!rows.length && <p className="text-xs text-slate-400">No data yet</p>}
    </div>
  )
}
