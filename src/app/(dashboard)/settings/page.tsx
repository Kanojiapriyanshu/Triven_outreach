'use client'
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Clock, Shield, Repeat, Trash2, Phone } from 'lucide-react'
import { DEFAULT_SEND_WINDOW, describeWindow, windowInZone, type SendWindow } from '@/lib/send-window'
import { fmtDate } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Settings {
  sendWindow: SendWindow
  followUpDays: [number, number, number]
  dailyCapPerSender: number
  minGapMinutes: number
  maxGapMinutes: number
  demoPhone: string
}

const DEFAULTS: Settings = {
  sendWindow: DEFAULT_SEND_WINDOW, followUpDays: [3, 7, 14], dailyCapPerSender: 40, minGapMinutes: 8, maxGapMinutes: 15, demoPhone: '',
}

const ZONES = [
  { tz: 'Asia/Kolkata', label: 'India (IST)' },
  { tz: 'Europe/London', label: 'UK (GMT/BST)' },
  { tz: 'America/New_York', label: 'US Eastern' },
  { tz: 'America/Chicago', label: 'US Central' },
  { tz: 'America/Denver', label: 'US Mountain' },
  { tz: 'America/Los_Angeles', label: 'US Pacific' },
]

/** What the window looks like for the people receiving the email */
function recipientTimes(w: SendWindow) {
  return ZONES.filter((z) => z.tz !== w.timezone && z.tz !== 'America/Denver')
    .map((z) => `${z.label}: ${windowInZone(w, z.tz)}`)
}

export default function SettingsPage() {
  const { data, mutate } = useSWR<Settings>('/api/settings', fetcher)
  const { data: suppression, mutate: mutateSuppression } = useSWR<Array<{ id: string; email?: string; domain?: string; reason?: string; addedAt: string }>>('/api/suppression', fetcher)
  const [form, setForm] = useState<Settings>(DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [blockValue, setBlockValue] = useState('')

  useEffect(() => { if (data && 'sendWindow' in data) setForm({ ...DEFAULTS, ...data }) }, [data])

  function setWindow(patch: Partial<SendWindow>) {
    setForm((f) => ({ ...f, sendWindow: { ...f.sendWindow, ...patch } }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(d.error || 'Could not save settings')
      toast.success('Settings saved')
      mutate()
    } finally { setSaving(false) }
  }

  async function addBlock() {
    const res = await fetch('/api/suppression', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: blockValue }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(d.error || 'Could not add')
    toast.success(d.leadsStopped ? `Blocked · ${d.leadsStopped} lead(s) stopped` : 'Blocked')
    setBlockValue('')
    mutateSuppression()
  }

  async function removeBlock(id: string) {
    await fetch(`/api/suppression?id=${id}`, { method: 'DELETE' })
    mutateSuppression()
  }

  const w = form.sendWindow

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">How and when your outreach goes out.</p>
      </div>

      {/* Sending window */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-indigo-600" />
            <CardTitle>Sending Window</CardTitle>
          </div>
          <CardDescription>
            Follow-ups and &ldquo;send in window&rdquo; emails go out at random times inside this window. Emails you send yourself go immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label>Your timezone</Label>
              <select
                value={w.timezone}
                onChange={(e) => setWindow({ timezone: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {ZONES.map((z) => <option key={z.tz} value={z.tz}>{z.label}</option>)}
              </select>
            </div>
            <div>
              <Label>From</Label>
              <Input type="time" value={w.start} onChange={(e) => setWindow({ start: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label>Until</Label>
              <Input
                type="time"
                value={w.end === '24:00' ? '00:00' : w.end}
                onChange={(e) => setWindow({ end: e.target.value === '00:00' ? '24:00' : e.target.value })}
                className="mt-1"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={w.skipWeekends}
              onChange={(e) => setWindow({ skipWeekends: e.target.checked })}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            Don&apos;t send on Saturdays and Sundays
          </label>
          <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2.5 text-xs text-indigo-900 space-y-0.5">
            <p className="font-medium">Window: {describeWindow(w)}. Your prospects receive it at:</p>
            {recipientTimes(w).map((line) => <p key={line}>{line}</p>)}
          </div>
          <div className="max-w-xs">
            <Label>Daily limit per Gmail account</Label>
            <Input
              type="number"
              min={1}
              max={500}
              value={form.dailyCapPerSender}
              onChange={(e) => setForm((f) => ({ ...f, dailyCapPerSender: Number(e.target.value) || 1 }))}
              className="mt-1"
            />
            <p className="text-xs text-slate-400 mt-1">New accounts warm up automatically: 5 a day in week 1, then 10, 20 and 30, before this limit applies.</p>
          </div>
          <div>
            <Label>Gap between emails from the same inbox</Label>
            <div className="mt-1 flex items-center gap-2 text-sm text-slate-600">
              <Input
                type="number"
                min={1}
                value={form.minGapMinutes}
                onChange={(e) => setForm((f) => ({ ...f, minGapMinutes: Math.max(1, Number(e.target.value) || 1) }))}
                className="w-20"
              />
              to
              <Input
                type="number"
                min={1}
                value={form.maxGapMinutes}
                onChange={(e) => setForm((f) => ({ ...f, maxGapMinutes: Math.max(1, Number(e.target.value) || 1) }))}
                className="w-20"
              />
              minutes (random each time)
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Each inbox sends one email, then waits a random time in this range. Inboxes take turns, so with 6 inboxes something goes out every couple of minutes.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Demo line */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-indigo-600" />
            <CardTitle>Demo Phone Number</CardTitle>
          </div>
          <CardDescription>
            The number prospects call to test your AI receptionist. Templates use it as {'{{demoPhone}}'} (the dental Follow-up 3 is built around it).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            value={form.demoPhone}
            onChange={(e) => setForm((f) => ({ ...f, demoPhone: e.target.value }))}
            placeholder="+1 (555) 010-2030"
            className="max-w-xs"
          />
          {!form.demoPhone && <p className="text-xs text-amber-600 mt-1.5">Not set: emails that use it fall back to offering to set up a demo.</p>}
        </CardContent>
      </Card>

      {/* Follow-up defaults */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Repeat className="h-4 w-4 text-indigo-600" />
            <CardTitle>Default Follow-up Schedule</CardTitle>
          </div>
          <CardDescription>Days after the first email. A campaign&apos;s own schedule overrides this, and you can change it per email.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {form.followUpDays.map((d, i) => (
              <div key={i}>
                <Label>Follow-up {i + 1}</Label>
                <Input
                  type="number"
                  min={1}
                  value={d}
                  onChange={(e) => {
                    const days = [...form.followUpDays] as Settings['followUpDays']
                    days[i] = Math.max(1, Number(e.target.value) || 1)
                    setForm((f) => ({ ...f, followUpDays: days }))
                  }}
                  className="mt-1"
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} loading={saving}>Save Settings</Button>
      </div>

      {/* Suppression list */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-indigo-600" />
            <CardTitle>Do-not-contact List</CardTitle>
          </div>
          <CardDescription>
            Nobody here is ever emailed. Bounced addresses are added automatically. Blocking a domain covers everyone at it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={(e) => { e.preventDefault(); addBlock() }} className="flex gap-2">
            <Input value={blockValue} onChange={(e) => setBlockValue(e.target.value)} placeholder="someone@example.com or example.com" className="flex-1" />
            <Button type="submit" variant="outline" size="sm" disabled={!blockValue.trim()}>Block</Button>
          </form>
          {Array.isArray(suppression) && suppression.length > 0 && (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 max-h-64 overflow-y-auto">
              {suppression.map((s) => (
                <div key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-slate-700">{s.email || s.domain}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400">{(s.reason || '').replace(/_/g, ' ').toLowerCase()} · {fmtDate(s.addedAt)}</span>
                    <button onClick={() => removeBlock(s.id)} className="text-slate-300 hover:text-red-500" title="Remove">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
