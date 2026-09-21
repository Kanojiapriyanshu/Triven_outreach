'use client'
import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Plus, Megaphone, Trash2, Pause, Play, Rocket, Settings2, Upload, Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { describeWindow, DEFAULT_SEND_WINDOW, type SendWindow } from '@/lib/send-window'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Stats { queued: number; noEmail: number; contacted: number; sentToday: number; replied: number; bounced: number; followUpsPending: number }
interface Campaign {
  id: string; name: string; industry: string
  sendingStatus: 'DRAFT' | 'ACTIVE' | 'PAUSED'
  dailyNewLeads: number; launchedAt?: string | null
  followUpDay1: number; followUpDay2: number; followUpDay3: number
  _count: { leads: number; templates: number }
  senderAccounts: Array<{ senderAccount: { id: string; displayName: string; email: string; gmailStatus: string } }>
  stats: Stats
}
interface Sender { id: string; displayName: string; email: string; gmailStatus: string }

const STATUS = {
  DRAFT:  { label: 'Draft',   variant: 'secondary' as const },
  ACTIVE: { label: 'Sending', variant: 'success' as const },
  PAUSED: { label: 'Paused',  variant: 'warning' as const },
}

const EMPTY = { name: '', industry: '', dailyNewLeads: 30, followUpDay1: 3, followUpDay2: 7, followUpDay3: 14, senderAccountIds: [] as string[] }

function pct(n: number, d: number) {
  return d ? `${Math.round((n / d) * 100)}%` : '–'
}

export default function CampaignsPage() {
  const { data, mutate } = useSWR<Campaign[]>('/api/campaigns', fetcher, { refreshInterval: 30_000 })
  const { data: sendersData } = useSWR<Sender[]>('/api/sender-accounts', fetcher)
  const { data: settings } = useSWR<{ sendWindow: SendWindow; minGapMinutes: number; maxGapMinutes: number }>('/api/settings', fetcher)
  const campaigns = Array.isArray(data) ? data : []
  const senders = Array.isArray(sendersData) ? sendersData : []

  const [editing, setEditing] = useState<Campaign | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY)

  function openNew() {
    setEditing(null)
    setForm({ ...EMPTY, senderAccountIds: senders.filter((s) => s.gmailStatus === 'CONNECTED').map((s) => s.id) })
    setShowForm(true)
  }

  function openEdit(c: Campaign) {
    setEditing(c)
    setForm({
      name: c.name, industry: c.industry, dailyNewLeads: c.dailyNewLeads,
      followUpDay1: c.followUpDay1, followUpDay2: c.followUpDay2, followUpDay3: c.followUpDay3,
      senderAccountIds: c.senderAccounts.map((s) => s.senderAccount.id),
    })
    setShowForm(true)
  }

  function toggleSender(id: string) {
    setForm((p) => ({
      ...p,
      senderAccountIds: p.senderAccountIds.includes(id) ? p.senderAccountIds.filter((s) => s !== id) : [...p.senderAccountIds, id],
    }))
  }

  async function save() {
    if (!form.name.trim()) return toast.error('Name the campaign')
    setSaving(true)
    try {
      const res = await fetch(editing ? `/api/campaigns/${editing.id}` : '/api/campaigns', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, industry: form.industry.trim() || form.name.trim() }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(d.error || 'Could not save')
      toast.success(editing ? 'Campaign updated' : 'Campaign created. Import leads into it, then Launch.')
      setShowForm(false)
      mutate()
    } finally { setSaving(false) }
  }

  async function setStatus(c: Campaign, sendingStatus: Campaign['sendingStatus']) {
    setBusy(c.id)
    try {
      const res = await fetch(`/api/campaigns/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendingStatus }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(d.error || 'Could not update')
      toast.success(sendingStatus === 'ACTIVE'
        ? `${c.name} is live. Emails start in the next send window.`
        : `${c.name} paused. Nothing more goes out until you resume.`)
      mutate()
    } finally { setBusy(null) }
  }

  async function remove(c: Campaign) {
    if (!confirm(`Delete "${c.name}"? Its leads stay in the CRM but leave the campaign.`)) return
    await fetch(`/api/campaigns/${c.id}`, { method: 'DELETE' })
    toast.success('Campaign deleted')
    mutate()
  }

  const w = settings?.sendWindow ?? DEFAULT_SEND_WINDOW

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Campaigns</h1>
          <p className="text-sm text-slate-500">
            Import leads into a campaign and launch it. Emails go out automatically, rotating across your inboxes,
            weekdays {describeWindow(w)}, {settings?.minGapMinutes ?? 8}–{settings?.maxGapMinutes ?? 15} min apart per inbox.
          </p>
        </div>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4" />New Campaign</Button>
      </div>

      {data && campaigns.length === 0 && (
        <Card>
          <CardContent className="py-16 flex flex-col items-center text-center">
            <Megaphone className="h-12 w-12 text-slate-300 mb-3" />
            <h3 className="text-lg font-semibold text-slate-700">No campaigns yet</h3>
            <p className="text-sm text-slate-400 mt-1 max-w-md">Create a campaign, import your leads into it, and launch. The system sends the first emails and follow-ups on its own.</p>
            <Button size="sm" className="mt-4" onClick={openNew}><Plus className="h-4 w-4" />Create Campaign</Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {campaigns.map((c) => {
          const s = c.stats
          const inboxes = c.senderAccounts.length ? c.senderAccounts.map((x) => x.senderAccount) : senders
          const liveInboxes = inboxes.filter((x) => x.gmailStatus === 'CONNECTED').length
          const daysLeft = s.queued ? Math.ceil(s.queued / Math.max(1, c.dailyNewLeads)) : 0
          const st = STATUS[c.sendingStatus] ?? STATUS.DRAFT
          return (
            <Card key={c.id}>
              <CardContent className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-base font-semibold text-slate-900">{c.name}</h2>
                      <Badge variant={st.variant} className="text-xs">
                        {c.sendingStatus === 'ACTIVE' && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
                        {st.label}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">{c.industry}</Badge>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {liveInboxes} inbox{liveInboxes === 1 ? '' : 'es'} rotating · up to {c.dailyNewLeads} new leads/day ·
                      follow-ups on day {c.followUpDay1}, {c.followUpDay2}, {c.followUpDay3}
                      {c.sendingStatus === 'ACTIVE' && s.queued > 0 && <> · queue done in ~{daysLeft} working day{daysLeft === 1 ? '' : 's'}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {c.sendingStatus === 'ACTIVE' ? (
                      <Button size="sm" variant="outline" loading={busy === c.id} onClick={() => setStatus(c, 'PAUSED')}>
                        <Pause className="h-3.5 w-3.5" />Pause
                      </Button>
                    ) : (
                      <Button size="sm" loading={busy === c.id} onClick={() => setStatus(c, 'ACTIVE')} disabled={s.queued === 0 && s.followUpsPending === 0}>
                        {c.sendingStatus === 'PAUSED' ? <><Play className="h-3.5 w-3.5" />Resume</> : <><Rocket className="h-3.5 w-3.5" />Launch</>}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => openEdit(c)} title="Settings"><Settings2 className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" className="text-slate-400 hover:text-red-500" onClick={() => remove(c)} title="Delete"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-4">
                  {[
                    { label: 'In queue', value: s.queued, hint: s.noEmail ? `+${s.noEmail} without email` : '' },
                    { label: 'Sent today', value: `${s.sentToday}/${c.dailyNewLeads}` },
                    { label: 'Contacted', value: s.contacted },
                    { label: 'Follow-ups planned', value: s.followUpsPending },
                    { label: 'Replied', value: s.replied, hint: pct(s.replied, s.contacted), tone: 'text-teal-700' },
                    { label: 'Bounced', value: s.bounced, hint: pct(s.bounced, s.contacted), tone: s.bounced && s.bounced / Math.max(1, s.contacted) > 0.03 ? 'text-red-600' : '' },
                  ].map((m) => (
                    <div key={m.label} className="rounded-lg bg-slate-50 px-3 py-2">
                      <p className="text-[11px] text-slate-500">{m.label}</p>
                      <p className={`text-lg font-semibold ${m.tone || 'text-slate-900'}`}>{m.value}</p>
                      {m.hint && <p className="text-[11px] text-slate-400">{m.hint}</p>}
                    </div>
                  ))}
                </div>

                {s.queued === 0 && c._count.leads === 0 && (
                  <div className="mt-3 flex items-center justify-between rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500">
                    No leads yet.
                    <Button size="sm" variant="outline" asChild><Link href="/imports"><Upload className="h-3.5 w-3.5" />Import leads</Link></Button>
                  </div>
                )}
                {c.sendingStatus === 'ACTIVE' && liveInboxes === 0 && (
                  <p className="mt-3 text-sm text-red-600">No connected inbox in this campaign, so nothing can send. Reconnect in Sender Accounts.</p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Campaign settings' : 'New Campaign'}</DialogTitle>
            <DialogDescription>A campaign is also a niche: its leads use its own templates when it has them (Templates page), otherwise General.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Dentists – US" className="mt-1" />
              </div>
              <div>
                <Label>Industry</Label>
                <Input value={form.industry} onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))} placeholder="Dental" className="mt-1" />
              </div>
            </div>
            <div>
              <Label>New leads per day</Label>
              <Input type="number" min={1} value={form.dailyNewLeads} onChange={(e) => setForm((f) => ({ ...f, dailyNewLeads: Math.max(1, Number(e.target.value) || 1) }))} className="mt-1 w-32" />
              <p className="text-xs text-slate-400 mt-1">First emails only. Follow-ups are extra. Each inbox also has its own daily limit and warm-up.</p>
            </div>
            <div>
              <Label>Follow-ups (days after the first email)</Label>
              <div className="flex items-center gap-2 mt-1">
                {(['followUpDay1', 'followUpDay2', 'followUpDay3'] as const).map((k) => (
                  <Input key={k} type="number" min={1} value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: Math.max(1, Number(e.target.value) || 1) }))} className="w-20" />
                ))}
              </div>
            </div>
            <div>
              <Label>Inboxes to rotate</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {senders.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSender(s.id)}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${form.senderAccountIds.includes(s.id) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:border-indigo-400'}`}
                    title={s.email}
                  >
                    <Inbox className="h-3 w-3" />{s.displayName}
                    {s.gmailStatus !== 'CONNECTED' && <span className="opacity-70">(disconnected)</span>}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-1">None selected = all connected inboxes.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={save} loading={saving}>{editing ? 'Save' : 'Create Campaign'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
