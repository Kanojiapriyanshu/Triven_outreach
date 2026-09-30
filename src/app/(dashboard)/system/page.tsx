'use client'
import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Activity, CheckCircle2, CircleAlert, XCircle, Play, Copy, Clock, Megaphone, ListChecks } from 'lucide-react'
import PageHeader from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { fmtRelative } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ActionStat { action: string; runs24h: number; uptime: number; failures24h: number; avgMs: number; last: { at: string; ok: boolean; durationMs: number; error: string | null; source: string | null } | null }
interface Capacity { id: string; name: string; status: string; queued: number; sentToday: number; dailyNewLeads: number; capacityToday: number; inboxes: number; state: string; reason: string }
interface SetupItem { key: string; ok: boolean; required: boolean; label: string; impact: string; href: string }
interface Data {
  worker: { expectedPerDay: number; hours: Array<{ hour: string; tick: number }>; actions: ActionStat[] }
  capacity: Capacity[]
  setup: SetupItem[]
  queues: { audience: { total: number }; finder: { total: number }; followUpsDue: number; followUpsOverdue: number }
  errors: Array<{ action: string; startedAt: string; error: string | null }>
  scheduler: { url: string; autoUrl: string; header: string; secretSet: boolean }
}

const ACTION_LABEL: Record<string, string> = { tick: 'Send & replies', audience: 'Audience pipeline', finder: 'Lead Finder' }
const STATE_STYLE: Record<string, string> = { SENDING: 'bg-emerald-50 text-emerald-700', IDLE: 'bg-slate-100 text-slate-600', BLOCKED: 'bg-red-50 text-red-700', OFF: 'bg-slate-100 text-slate-400' }

export default function SystemPage() {
  const { data, mutate } = useSWR<Data>('/api/system', fetcher, { refreshInterval: 30_000 })
  const [running, setRunning] = useState('')

  async function run(action: string) {
    setRunning(action)
    try {
      const res = await fetch('/api/system', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      const d = await res.json()
      if (!res.ok) toast.error(d.error || 'Run failed')
      else toast.success(`${ACTION_LABEL[action] || action} ran`)
      mutate()
    } finally { setRunning('') }
  }

  const tick = data?.worker.actions.find((a) => a.action === 'tick')
  const healthy = !!tick && tick.uptime >= 90
  const maxHour = Math.max(12, ...(data?.worker.hours.map((h) => h.tick) || [0]))

  return (
    <div className="space-y-5 max-w-6xl">
      <PageHeader section="Configuration" title="System health" icon={Activity}
        description="Is the background worker running on time, can every campaign send, and what's still missing." />

      {/* Scheduler */}
      <Card className={healthy ? '' : 'border-amber-300'}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            {healthy ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <CircleAlert className="h-4 w-4 text-amber-600" />}
            Background worker {data && <span className="text-sm font-normal text-slate-500">· sending expected every 5 min, research every 15 min</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {(data?.worker.actions || []).map((a) => (
              <div key={a.action} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-800">{ACTION_LABEL[a.action]}</p>
                  <Button size="sm" variant="ghost" onClick={() => run(a.action)} loading={running === a.action} title="Run now"><Play className="h-3.5 w-3.5" /></Button>
                </div>
                <p className={`text-2xl font-semibold tabular-nums ${a.uptime >= 90 ? 'text-emerald-700' : a.uptime >= 30 ? 'text-amber-600' : 'text-red-600'}`}>{a.uptime}%</p>
                <p className="text-[11px] text-slate-500">{a.runs24h} runs in 24 h{a.failures24h ? ` · ${a.failures24h} failed` : ''} · avg {Math.round(a.avgMs / 1000)} s</p>
                <p className="mt-1 text-[11px] text-slate-400">{a.last ? <>Last {fmtRelative(a.last.at)}{a.last.source ? ` · ${a.last.source.split(/[\s/]/)[0]}` : ''}</> : 'Never ran'}</p>
                {a.last && !a.last.ok && <p className="mt-1 text-[11px] text-red-600 line-clamp-2">{a.last.error}</p>}
              </div>
            ))}
          </div>

          {/* Runs per hour (send & replies) */}
          {data && (
            <div>
              <p className="mb-1 text-xs text-slate-500">Send & replies runs per hour, last 24 h (12 = on time)</p>
              <div className="flex h-16 items-end gap-[2px] border-b border-slate-200">
                {data.worker.hours.map((h) => (
                  <div key={h.hour} className="flex h-full flex-1 items-end" title={`${new Date(h.hour).toLocaleString('en-US', { hour: 'numeric', day: 'numeric', month: 'short' })}: ${h.tick} runs`}>
                    <div className={`w-full rounded-t-[3px] ${h.tick >= 10 ? 'bg-emerald-400' : h.tick > 0 ? 'bg-amber-400' : 'bg-slate-200'}`} style={{ height: `${Math.max(h.tick ? 6 : 3, (100 * h.tick) / maxHour)}%` }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {!healthy && data && <SchedulerSetup autoUrl={data.scheduler.autoUrl} />}
        </CardContent>
      </Card>

      {/* Campaign capacity */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><Megaphone className="h-4 w-4 text-slate-400" />Campaigns: can they send?</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-t border-slate-100 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-6 py-2">Campaign</th><th className="px-2 py-2 text-right">Queued</th><th className="px-2 py-2 text-right">Sent today</th><th className="px-2 py-2 text-right">Capacity</th><th className="px-6 py-2">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.capacity || []).map((c) => (
                <tr key={c.id}>
                  <td className="px-6 py-2.5 font-medium text-slate-800">{c.name}<span className="block text-[11px] font-normal text-slate-400">{c.inboxes} inbox{c.inboxes === 1 ? '' : 'es'}</span></td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{c.queued}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{c.sentToday}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{c.capacityToday}</td>
                  <td className="px-6 py-2.5"><span className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE_STYLE[c.state]}`}>{c.state.toLowerCase()}</span><span className="text-xs text-slate-600">{c.reason}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Setup */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><ListChecks className="h-4 w-4 text-slate-400" />Setup</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(data?.setup || []).map((s) => (
              <div key={s.key} className="flex items-start gap-2.5">
                {s.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : s.required ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
                <div className="min-w-0">
                  <p className="text-sm text-slate-800">{s.label}{!s.ok && s.required && <span className="ml-1 text-[10px] font-semibold uppercase text-red-600">required</span>}</p>
                  {!s.ok && <p className="text-xs text-slate-500">{s.impact} {s.href !== '/system' && <Link href={s.href} className="text-indigo-600 hover:underline">Fix</Link>}</p>}
                </div>
              </div>
            ))}
            <p className="pt-1 text-[11px] text-slate-400">API keys are added in Vercel → Settings → Environment Variables, then redeploy. See docs/TRIVEN-CRM-GUIDE.md for each one.</p>
          </CardContent>
        </Card>

        {/* Queues + errors */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><Clock className="h-4 w-4 text-slate-400" />Queues and errors</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <Queue label="Audience steps waiting" value={data?.queues.audience.total} />
              <Queue label="Lead Finder waiting" value={data?.queues.finder.total} />
              <Queue label="Follow-ups due" value={data?.queues.followUpsDue} />
              <Queue label="Follow-ups > 1 day late" value={data?.queues.followUpsOverdue} warn />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Recent errors</p>
              {!data?.errors.length ? <p className="text-xs text-slate-400">None</p> : data.errors.map((e, i) => (
                <p key={i} className="text-xs text-slate-600"><span className="text-slate-400">{fmtRelative(e.startedAt)} · {ACTION_LABEL[e.action] || e.action}:</span> {e.error}</p>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Queue({ label, value, warn }: { label: string; value?: number; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2.5">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${warn && value ? 'text-amber-600' : 'text-slate-900'}`}>{(value ?? 0).toLocaleString('en-US')}</p>
    </div>
  )
}

function SchedulerSetup({ autoUrl }: { autoUrl: string }) {
  const copy = (t: string) => { navigator.clipboard.writeText(t).then(() => toast.success('Copied')).catch(() => null) }
  if (!autoUrl) return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-900">
      WORKER_SECRET isn&apos;t set. Add it in Vercel → Settings → Environment Variables (any long random text), redeploy, then come back here.
    </div>
  )
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm text-slate-700">
      <p className="font-medium text-amber-900">Keep the worker on all the time: one free job, 2 minutes to set up.</p>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px]">
        <li>Sign up free at <a href="https://console.cron-job.org/signup" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">cron-job.org</a>.</li>
        <li>Click <strong>Create cronjob</strong> and paste this URL (click to copy):
          <button onClick={() => copy(autoUrl)} className="mt-1 flex w-full items-center justify-between gap-2 rounded bg-white px-2 py-1.5 text-left font-mono text-[11.5px] text-slate-700 hover:bg-slate-50">
            <span className="break-all">{autoUrl}</span><Copy className="h-3 w-3 shrink-0 text-slate-400" />
          </button>
        </li>
        <li>Set it to run <strong>every 1 minute</strong> and click <strong>Create</strong>. Nothing else to change.</li>
      </ol>
      <p className="mt-2 text-[12px] text-slate-500">Each call runs whatever is due (sending and replies every couple of minutes, Lead Finder and audience research every ~10). Within a few minutes the uptime above turns green. Keep this URL private: it contains your worker secret.</p>
    </div>
  )
}
