'use client'
import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { ArrowRight, Flame, CircleAlert, Sparkles, Wrench, CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Move { id: string; severity: 'urgent' | 'high' | 'normal' | 'setup'; title: string; detail: string; href: string; cta: string; count?: number }
interface Data {
  moves: Move[]
  funnel: Array<{ key: string; label: string; value: number }>
  activity: Array<{ day: string; sent: number; replies: number }>
}

const SEVERITY = {
  urgent: { icon: Flame, dot: 'bg-red-500', text: 'text-red-600', label: 'Now' },
  high: { icon: CircleAlert, dot: 'bg-amber-500', text: 'text-amber-600', label: 'Today' },
  normal: { icon: Sparkles, dot: 'bg-emerald-500', text: 'text-emerald-600', label: 'Grow' },
  setup: { icon: Wrench, dot: 'bg-slate-400', text: 'text-slate-500', label: 'Setup' },
}

/** The CEO view: what to do next (ranked by money impact), the 30-day funnel, and sending activity */
export default function CommandCenter() {
  const { data } = useSWR<Data>('/api/command', fetcher, { refreshInterval: 60_000 })
  const moves = data?.moves || []
  const work = moves.filter((m) => m.severity !== 'setup')
  const setup = moves.filter((m) => m.severity === 'setup')

  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <Card className="xl:col-span-3">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span>Your next moves</span>
            {data && <span className="text-xs font-normal text-slate-400">{work.length ? `${work.length} to do` : 'Nothing urgent'}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!data ? <div className="mx-6 mb-6 h-40 animate-pulse rounded-lg bg-slate-100" /> : (
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {work.length === 0 && (
                <li className="flex items-center gap-3 px-6 py-5 text-sm text-slate-600"><CheckCircle2 className="h-5 w-5 text-emerald-500" />All caught up. Replies, launches and refills show up here the moment they need you.</li>
              )}
              {work.slice(0, 7).map((m) => {
                const s = SEVERITY[m.severity]
                return (
                  <li key={m.id}>
                    <Link href={m.href} className="group flex items-center gap-4 px-6 py-3 hover:bg-slate-50">
                      <span className={`w-12 shrink-0 text-[10px] font-semibold uppercase tracking-wide ${s.text}`}><s.icon className="mb-0.5 h-3.5 w-3.5" />{s.label}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-900">{m.title}</span>
                        <span className="block truncate text-xs text-slate-500">{m.detail}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-indigo-600 opacity-80 group-hover:opacity-100">{m.cta}<ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
          {setup.length > 0 && (
            <div className="border-t border-slate-100 bg-slate-50/60 px-6 py-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Unlock more leads</p>
              <div className="flex flex-wrap gap-2">
                {setup.map((m) => (
                  <Link key={m.id} href={m.href} title={m.detail} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:border-indigo-400 hover:text-indigo-700">{m.title}</Link>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4 xl:col-span-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Pipeline, last 30 days</CardTitle></CardHeader>
          <CardContent>{data ? <Funnel steps={data.funnel} /> : <div className="h-40 animate-pulse rounded-lg bg-slate-100" />}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Emails sent per day, last 14 days</CardTitle></CardHeader>
          <CardContent>{data ? <SentChart days={data.activity} /> : <div className="h-28 animate-pulse rounded-lg bg-slate-100" />}</CardContent>
        </Card>
      </div>
    </div>
  )
}

function Funnel({ steps }: { steps: Data['funnel'] }) {
  const max = Math.max(1, ...steps.map((s) => s.value))
  return (
    <div className="space-y-1.5">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : 0
        const rate = i > 0 && prev > 0 ? Math.round((100 * s.value) / prev) : null
        return (
          <div key={s.key} className="grid grid-cols-[76px_1fr_64px] items-center gap-2" title={`${s.label}: ${s.value.toLocaleString('en-US')}`}>
            <span className="text-xs text-slate-600">{s.label}</span>
            <span className="h-3.5 rounded-r bg-slate-100">
              <span className="block h-full rounded-r-[4px] bg-indigo-500" style={{ width: `${Math.max(s.value ? 1.5 : 0, (100 * s.value) / max)}%` }} />
            </span>
            <span className="text-right text-xs tabular-nums text-slate-800">
              {s.value.toLocaleString('en-US')}
              {rate !== null && <span className="ml-1 text-[10px] text-slate-400">{rate}%</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Single series (emails sent), hover shows that day's replies too. Separate scales never share an axis. */
function SentChart({ days }: { days: Data['activity'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...days.map((d) => d.sent))
  const totalSent = days.reduce((n, d) => n + d.sent, 0)
  const totalReplies = days.reduce((n, d) => n + d.replies, 0)
  const h = hover !== null ? days[hover] : null
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-4 text-xs text-slate-500">
        <span><strong className="text-base font-semibold text-slate-900 tabular-nums">{totalSent.toLocaleString('en-US')}</strong> sent</span>
        <span><strong className="text-base font-semibold text-slate-900 tabular-nums">{totalReplies.toLocaleString('en-US')}</strong> replies</span>
        <span><strong className="text-base font-semibold text-slate-900 tabular-nums">{totalSent ? ((100 * totalReplies) / totalSent).toFixed(1) : '0.0'}%</strong> reply rate</span>
      </div>
      <div className="relative">
        <div className="flex h-24 items-end gap-[2px] border-b border-slate-200" onMouseLeave={() => setHover(null)}>
          {days.map((d, i) => (
            <div key={d.day} className="flex h-full flex-1 cursor-default items-end" onMouseEnter={() => setHover(i)}>
              <div className={`w-full rounded-t-[4px] transition-colors ${hover === i ? 'bg-indigo-600' : 'bg-indigo-400'}`} style={{ height: `${d.sent ? Math.max(4, (100 * d.sent) / max) : 0}%` }} />
            </div>
          ))}
        </div>
        {h && hover !== null && (
          <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] shadow-lg"
            style={{ left: `${((hover + 0.5) / days.length) * 100}%` }}>
            <p className="font-medium text-slate-800">{new Date(`${h.day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
            <p className="text-slate-600">{h.sent} sent · {h.replies} repl{h.replies === 1 ? 'y' : 'ies'}</p>
          </div>
        )}
        <div className="mt-1 flex justify-between text-[10px] text-slate-400">
          <span>{new Date(`${days[0]?.day}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          <span>Today</span>
        </div>
      </div>
    </div>
  )
}
