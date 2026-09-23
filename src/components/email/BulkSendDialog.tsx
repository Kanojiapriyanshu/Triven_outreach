'use client'
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Send, AlertTriangle, CheckCircle2, Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { buildTemplateVars, renderTemplate, pickDefaultTemplate, checkLeadData, type TemplateLead } from '@/lib/template'
import { DEFAULT_SEND_WINDOW, DAY_LABELS, fmtInZone, staggeredSlots, type SendWindow } from '@/lib/send-window'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export interface BulkLead extends TemplateLead {
  id: string
  companyName: string
  companyEmail?: string | null
  campaignId?: string | null
  firstEmailSentAt?: string | null
}

interface Template { id: string; name: string; subject: string; body: string; type: string; campaignId?: string | null; isDefault?: boolean; campaign?: { name: string } | null }
interface Sender { id: string; displayName: string; email: string; gmailStatus: string }

const EACH = '__each'

export default function BulkSendDialog({ leads, onClose, onDone }: { leads: BulkLead[]; onClose: () => void; onDone: () => void }) {
  const { data: templatesData } = useSWR<Template[]>('/api/templates?type=FIRST_EMAIL', fetcher)
  const { data: sendersData } = useSWR<Sender[]>('/api/sender-accounts', fetcher)
  const { data: allowance } = useSWR<Record<string, { left: number; limit: number; warmingUp: boolean }>>('/api/sender-accounts/allowance', fetcher)
  const { data: settings } = useSWR<{ sendWindow: SendWindow; demoPhone?: string; builderUrl?: string; senderAddress?: string; minGapMinutes: number; maxGapMinutes: number }>('/api/settings', fetcher)
  const templates = Array.isArray(templatesData) ? templatesData : []
  const connected = (Array.isArray(sendersData) ? sendersData : []).filter((s) => s.gmailStatus === 'CONNECTED')

  const [templateId, setTemplateId] = useState(EACH)
  const [picked, setPicked] = useState<string[] | null>(null) // null = all connected
  const [start, setStart] = useState<'now' | 'custom'>('now')
  const [customAt, setCustomAt] = useState('')
  // Pacing (Instantly-style): sending hours, days, and gap between emails
  const [winStart, setWinStart] = useState<string | null>(null)
  const [winEnd, setWinEnd] = useState<string | null>(null)
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [gapMin, setGapMin] = useState(3)
  const [gapMax, setGapMax] = useState(5)
  const [index, setIndex] = useState(0)
  const [sending, setSending] = useState(false)

  const inboxes = picked ?? connected.map((s) => s.id)
  const eligible = leads.filter((l) => l.companyEmail && !l.firstEmailSentAt)
  const excluded = leads.length - eligible.length

  // Preview each lead with the inbox it would most likely get
  const previews = useMemo(() => eligible.map((lead, i) => {
    const t = templateId === EACH ? pickDefaultTemplate(templates, 'FIRST_EMAIL', lead.campaignId) : templates.find((x) => x.id === templateId)
    const sender = connected.find((s) => s.id === inboxes[i % Math.max(1, inboxes.length)])
    const vars = buildTemplateVars(lead, sender, { demoPhone: settings?.demoPhone, builderUrl: settings?.builderUrl, senderAddress: settings?.senderAddress })
    return {
      lead,
      template: t,
      sender,
      subject: t ? renderTemplate(t.subject, vars) : '',
      body: t ? renderTemplate(t.body, vars) : '',
      check: checkLeadData(lead, vars),
    }
  }), [eligible, templateId, templates, connected, inboxes, settings?.demoPhone, settings?.builderUrl, settings?.senderAddress])

  const thin = previews.filter((p) => p.check.level === 'thin').length
  const noTemplate = previews.filter((p) => !p.template).length
  const perDay = inboxes.reduce((n, id) => n + (allowance?.[id]?.limit ?? 0), 0)
  const estDays = perDay ? Math.ceil(eligible.length / perDay) : null
  const current = previews[Math.min(index, previews.length - 1)]
  const w = settings?.sendWindow ?? DEFAULT_SEND_WINDOW
  const win: SendWindow = { ...w, start: winStart ?? w.start, end: winEnd ?? w.end, days }
  const fromDate = start === 'custom' && customAt ? new Date(customAt) : new Date()
  // Same maths as the server, so the timeline shown is what will happen
  const timeline = useMemo(
    () => staggeredSlots(eligible.length, fromDate, win, gapMin, Math.max(gapMin, gapMax), Math.max(1, perDay || Infinity), () => 0.5),
    [eligible.length, fromDate.getTime(), win.start, win.end, days.join(), gapMin, gapMax, perDay], // eslint-disable-line react-hooks/exhaustive-deps
  )

  async function submit() {
    if (!eligible.length) return toast.error('None of the selected leads can be emailed')
    if (!inboxes.length) return toast.error('Pick at least one inbox')
    if (start === 'custom' && !customAt) return toast.error('Pick a start date and time')
    if (!days.length) return toast.error('Pick at least one sending day')
    setSending(true)
    try {
      const res = await fetch('/api/email/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadIds: eligible.map((l) => l.id),
          templateId: templateId === EACH ? undefined : templateId,
          senderAccountIds: inboxes,
          start: start === 'custom' ? new Date(customAt).toISOString() : 'now',
          schedule: { windowStart: win.start, windowEnd: win.end, days, gapMin, gapMax: Math.max(gapMin, gapMax) },
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(d.error || 'Could not queue emails')
      const skippedTotal = Object.values(d.skipped as Record<string, number>).reduce((a, b) => a + b, 0)
      toast.success(`${d.queued} emails queued across ${d.inboxes} inboxes${d.startAt ? ` · first ${fmtInZone(d.startAt, w, 'EEE h:mm a')}, last ${fmtInZone(d.lastAt, w, 'EEE h:mm a')}` : ''}${skippedTotal ? ` · ${skippedTotal} skipped` : ''}`)
      onDone()
    } finally { setSending(false) }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-full max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-slate-100 shrink-0">
          <DialogTitle className="flex items-center gap-2"><Send className="h-4 w-4 text-indigo-600" />Send to {eligible.length} lead{eligible.length === 1 ? '' : 's'}</DialogTitle>
          <DialogDescription>
            Each email is written with that lead&apos;s own details and goes out on your schedule: one email, switch to the next inbox,
            wait {gapMin}–{Math.max(gapMin, gapMax)} min, repeat. Follow-ups are planned automatically.
            {excluded > 0 && <> {excluded} selected lead{excluded > 1 ? 's are' : ' is'} left out (no email or already contacted).</>}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-5">
          {/* Options */}
          <div className="md:col-span-2 p-5 space-y-5 border-b md:border-b-0 md:border-r border-slate-100">
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1.5">Email template</p>
              <select
                value={templateId}
                onChange={(e) => { setTemplateId(e.target.value); setIndex(0) }}
                className="w-full h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm"
              >
                <option value={EACH}>Each lead&apos;s niche default ★</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.campaign ? ` (${t.campaign.name})` : ''}</option>)}
              </select>
            </div>

            <div>
              <p className="text-xs font-medium text-slate-500 mb-1.5">Send from (rotation)</p>
              <div className="space-y-1">
                {connected.map((s) => {
                  const on = inboxes.includes(s.id)
                  const a = allowance?.[s.id]
                  return (
                    <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setPicked(on ? inboxes.filter((x) => x !== s.id) : [...inboxes, s.id])}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <Inbox className="h-3.5 w-3.5 text-slate-400" />
                      <span className="flex-1 truncate">{s.displayName}</span>
                      {a && <span className="text-xs text-slate-400">{a.limit}/day{a.warmingUp ? ' (warming up)' : ''}</span>}
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2.5">
              <p className="text-xs font-medium text-slate-500">Schedule</p>
              <div className="flex items-center gap-1.5 text-sm text-slate-600">
                <input type="time" value={win.start} onChange={(e) => setWinStart(e.target.value)} className="h-8 w-[6.5rem] rounded-lg border border-slate-300 px-2 text-sm" />
                to
                <input
                  type="time"
                  value={win.end === '24:00' ? '00:00' : win.end}
                  onChange={(e) => setWinEnd(e.target.value === '00:00' ? '24:00' : e.target.value)}
                  className="h-8 w-[6.5rem] rounded-lg border border-slate-300 px-2 text-sm"
                />
              </div>
              <div className="flex flex-wrap gap-1">
                {DAY_LABELS.map((d, i) => {
                  const day = i + 1
                  const on = days.includes(day)
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDays(on ? days.filter((x) => x !== day) : [...days, day])}
                      className={`w-10 py-0.5 rounded text-[11px] font-medium border ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-300'}`}
                    >
                      {d}
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center gap-1.5 text-sm text-slate-600">
                Gap
                <input type="number" min={1} value={gapMin} onChange={(e) => setGapMin(Math.max(1, Number(e.target.value) || 1))} className="h-8 w-14 rounded-lg border border-slate-300 px-2 text-sm" />
                to
                <input type="number" min={1} value={gapMax} onChange={(e) => setGapMax(Math.max(1, Number(e.target.value) || 1))} className="h-8 w-14 rounded-lg border border-slate-300 px-2 text-sm" />
                min between emails
              </div>
              <div className="space-y-1 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={start === 'now'} onChange={() => setStart('now')} className="text-indigo-600" />
                  Start now (or when the hours above begin)
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={start === 'custom'} onChange={() => setStart('custom')} className="text-indigo-600" />
                  Start on a date
                </label>
                {start === 'custom' && (
                  <input type="datetime-local" value={customAt} onChange={(e) => setCustomAt(e.target.value)} className="h-8 w-full rounded-lg border border-slate-300 px-2 text-sm" />
                )}
              </div>
              <p className="text-[11px] text-slate-400">Times are {w.timezone.replace('_', ' ')}. One email, switch inbox, wait {gapMin}–{Math.max(gapMin, gapMax)} min, next.</p>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 space-y-1">
              <p><strong>{eligible.length}</strong> emails · <strong>{inboxes.length}</strong> inboxes · up to <strong>{perDay}</strong>/day</p>
              {timeline.length > 0 && (
                <p>
                  First <strong>{fmtInZone(timeline[0], w, 'EEE h:mm a')}</strong>, last <strong>{fmtInZone(timeline[timeline.length - 1], w, 'EEE h:mm a')}</strong>
                  {estDays && estDays > 1 ? <> · spread over {estDays} sending days (daily limits)</> : null}
                </p>
              )}
              {thin > 0 && <p className="text-amber-700">{thin} lead{thin > 1 ? 's have' : ' has'} thin data and will get a more general email. Preview them on the right.</p>}
              {noTemplate > 0 && <p className="text-red-600">{noTemplate} lead{noTemplate > 1 ? 's have' : ' has'} no first-email template for their niche and will be skipped.</p>}
            </div>
          </div>

          {/* Per-lead preview */}
          <div className="md:col-span-3 p-5 flex flex-col min-h-[420px]">
            {!current ? (
              <p className="text-sm text-slate-400">Nothing to preview.</p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{current.lead.fullName || current.lead.companyName}</p>
                    <p className="text-xs text-slate-400 truncate">{current.lead.companyEmail} · via {current.sender?.displayName ?? '…'}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                    <span className="text-xs text-slate-500 w-16 text-center">{index + 1} / {previews.length}</span>
                    <Button size="sm" variant="ghost" disabled={index >= previews.length - 1} onClick={() => setIndex((i) => i + 1)}><ChevronRight className="h-4 w-4" /></Button>
                  </div>
                </div>

                {current.check.level === 'ok' ? (
                  <p className="flex items-center gap-1.5 text-xs text-green-700 mb-2"><CheckCircle2 className="h-3.5 w-3.5" />Well personalised</p>
                ) : (
                  <div className="mb-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                    <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-3.5 w-3.5" />Thin data. The email still reads naturally:</p>
                    <ul className="list-disc pl-5 mt-1">{current.check.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                  </div>
                )}

                {current.template ? (
                  <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4 overflow-y-auto">
                    <p className="text-xs text-slate-400">Subject</p>
                    <p className="text-sm font-semibold text-slate-900 mb-3">{current.subject}</p>
                    <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{current.body}</p>
                  </div>
                ) : (
                  <p className="text-sm text-red-600">No first-email template for this lead&apos;s niche.</p>
                )}
              </>
            )}
          </div>
        </div>

        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={submit} loading={sending} disabled={!eligible.length || !inboxes.length}>
            <Send className="h-3.5 w-3.5" />Queue {eligible.length} email{eligible.length === 1 ? '' : 's'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
