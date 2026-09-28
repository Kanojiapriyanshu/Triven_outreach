'use client'
import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Kanban, Calendar, ArrowRight } from 'lucide-react'
import PageHeader from '@/components/layout/PageHeader'
import { useCaseLabel } from '@/lib/audience/usecases'
import { fmtCurrency, fmtDate, fmtRelative } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Item {
  id: string; fullName: string | null; companyName: string; companyEmail: string | null; status: string; dealValue: string | null
  meetingDate: string | null; saleDate: string | null; lastResponseAt: string | null; replyCategory: string | null
  leadSource: string; sourcePlatform: string | null; sourceChannel: string | null; useCase: string | null; industry: string | null
  campaign: { name: string } | null
}
interface Column { stage: string; count: number; value: number; items: Item[] }

const LABEL: Record<string, string> = { REPLIED: 'Replied', INTERESTED: 'Interested', MEETING_BOOKED: 'Meeting booked', PROPOSAL_SENT: 'Proposal sent', WON: 'Won', LOST: 'Lost' }
const TONE: Record<string, string> = { REPLIED: 'border-t-sky-400', INTERESTED: 'border-t-emerald-400', MEETING_BOOKED: 'border-t-indigo-500', PROPOSAL_SENT: 'border-t-violet-500', WON: 'border-t-emerald-600', LOST: 'border-t-slate-300' }
const NEXT: Record<string, string> = { REPLIED: 'INTERESTED', INTERESTED: 'MEETING_BOOKED', MEETING_BOOKED: 'PROPOSAL_SENT', PROPOSAL_SENT: 'WON' }
const SOURCE: Record<string, string> = { YOUTUBE: 'YouTube', HN: 'Hacker News', DEVTO: 'DEV', GOOGLE: 'Google Maps', OSM: 'OpenStreetMap' }

export default function PipelinePage() {
  const { data, mutate } = useSWR<{ columns: Column[] }>('/api/pipeline', fetcher, { refreshInterval: 60_000 })
  const cols = data?.columns || []
  const open = cols.filter((c) => !['WON', 'LOST'].includes(c.stage)).reduce((n, c) => n + c.value, 0)
  const won = cols.find((c) => c.stage === 'WON')?.value || 0

  async function update(id: string, body: Record<string, unknown>, msg?: string) {
    const res = await fetch(`/api/leads/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) return toast.error('Could not update')
    if (msg) toast.success(msg)
    mutate()
  }

  return (
    <div className="space-y-5">
      <PageHeader section="Outreach" title="Pipeline" icon={Kanban}
        description="Everyone who replied, from first answer to closed deal. Move a card forward as the conversation moves; deal values roll up here and on Audience → Sources."
        actions={<div className="text-right text-xs text-slate-500">Open pipeline <strong className="text-base text-slate-900">{fmtCurrency(open)}</strong> · won <strong className="text-base text-emerald-700">{fmtCurrency(won)}</strong></div>} />

      <div className="grid gap-3 overflow-x-auto pb-2 lg:grid-cols-6" style={{ minWidth: 0 }}>
        {cols.map((c) => (
          <div key={c.stage} className={`flex min-w-[230px] flex-col rounded-xl border border-slate-200 border-t-4 bg-slate-50/60 ${TONE[c.stage]}`}>
            <div className="flex items-baseline justify-between px-3 py-2">
              <p className="text-sm font-semibold text-slate-800">{LABEL[c.stage]} <span className="font-normal text-slate-400">{c.count}</span></p>
              {c.value > 0 && <p className="text-xs tabular-nums text-slate-600">{fmtCurrency(c.value)}</p>}
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2" style={{ maxHeight: '70vh' }}>
              {c.items.map((l) => <Card key={l.id} l={l} onUpdate={update} />)}
              {!c.items.length && <p className="px-1 py-6 text-center text-xs text-slate-400">Empty</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Card({ l, onUpdate }: { l: Item; onUpdate: (id: string, body: Record<string, unknown>, msg?: string) => void }) {
  const [value, setValue] = useState(l.dealValue ? String(Number(l.dealValue)) : '')
  const source = SOURCE[l.sourcePlatform || ''] || (l.leadSource === 'IMPORT' ? 'Import' : l.leadSource.toLowerCase())
  const next = NEXT[l.status]
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-xs">
      <Link href={`/leads/${l.id}`} className="block text-sm font-medium text-slate-900 hover:text-indigo-600">{l.fullName || l.companyName}</Link>
      <p className="truncate text-[11px] text-slate-500">{l.fullName ? l.companyName : l.companyEmail}</p>
      <p className="mt-1 text-[10px] text-slate-400">
        {source}{l.sourceChannel ? ` · ${l.sourceChannel}` : ''}{l.useCase && l.useCase !== 'UNKNOWN' ? ` · ${useCaseLabel(l.useCase)}` : l.industry ? ` · ${l.industry}` : ''}
      </p>
      {l.meetingDate && <p className="mt-1 flex items-center gap-1 text-[11px] text-indigo-700"><Calendar className="h-3 w-3" />{fmtDate(l.meetingDate, 'MMM d, h:mm a')}</p>}
      {l.lastResponseAt && <p className="text-[10px] text-slate-400">replied {fmtRelative(l.lastResponseAt)}</p>}
      <div className="mt-2 flex items-center gap-1">
        <span className="text-[11px] text-slate-400">$</span>
        <input value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => value !== (l.dealValue ? String(Number(l.dealValue)) : '') && onUpdate(l.id, { dealValue: value }, 'Deal value saved')}
          placeholder="deal value" className="h-6 w-20 rounded border border-slate-200 px-1 text-xs tabular-nums" />
        <select value="" onChange={(e) => e.target.value && onUpdate(l.id, { status: e.target.value }, `Moved to ${LABEL[e.target.value]}`)} className="ml-auto h-6 rounded border border-slate-200 px-1 text-[11px] text-slate-600">
          <option value="">Move…</option>
          {Object.entries(LABEL).filter(([k]) => k !== l.status).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {next && <button title={`Move to ${LABEL[next]}`} onClick={() => onUpdate(l.id, { status: next }, `Moved to ${LABEL[next]}`)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"><ArrowRight className="h-3.5 w-3.5" /></button>}
      </div>
    </div>
  )
}
