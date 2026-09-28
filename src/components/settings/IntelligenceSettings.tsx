'use client'
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Sparkles, ShieldOff, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { USE_CASES, type CapabilitySheet, type UseCase } from '@/lib/audience/usecases'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

/** Settings → Triven capabilities: the only things generated text may claim */
export function CapabilitiesCard() {
  const { data, mutate } = useSWR<CapabilitySheet>('/api/audience/capabilities', fetcher)
  const [c, setC] = useState<CapabilitySheet | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (data && !c) setC(data) }, [data, c])
  if (!c) return null
  const keys = (Object.keys(USE_CASES) as UseCase[]).filter((k) => k !== 'UNKNOWN')

  async function save() {
    setBusy(true)
    try {
      const res = await fetch('/api/audience/capabilities', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) })
      if (!res.ok) return toast.error((await res.json()).error || 'Could not save')
      toast.success('Capabilities saved. New "Why Triven" lines and emails use them.')
      mutate()
    } finally { setBusy(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-indigo-600" />Triven capabilities</CardTitle>
        <CardDescription>
          What Triven AI Builder does today, per use case. "Why Triven" lines, reply suggestions and the AI may only say what's written here, so keep it accurate.
          Unsupported use cases get a lower fit score. Template links are used in the use-case emails ({'{{templateOffer}}'}); empty = "reply and I'll send it".
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-500">Product name<Input value={c.product} onChange={(e) => setC({ ...c, product: e.target.value })} className="mt-1 h-8" /></label>
          <label className="text-xs text-slate-500">Blockers Triven removes (words separated by |)<Input value={c.removes} onChange={(e) => setC({ ...c, removes: e.target.value })} className="mt-1 h-8 font-mono text-xs" /></label>
        </div>
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {keys.map((k) => {
            const on = c.supported.includes(k)
            return (
              <div key={k} className="grid gap-2 p-2.5 md:grid-cols-[180px_1fr]">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={on} onChange={(e) => setC({ ...c, supported: e.target.checked ? [...c.supported, k] : c.supported.filter((x) => x !== k) })} />
                  <span className={on ? 'font-medium text-slate-800' : 'text-slate-400'}>{USE_CASES[k].label}</span>
                </label>
                <div className="space-y-1.5">
                  <Textarea rows={2} disabled={!on} value={c.lines[k] || ''} onChange={(e) => setC({ ...c, lines: { ...c.lines, [k]: e.target.value } })} placeholder={`${c.product} … (what it does for ${USE_CASES[k].short})`} className="text-xs" />
                  <Input disabled={!on} value={c.templateLinks[k] || ''} onChange={(e) => setC({ ...c, templateLinks: { ...c.templateLinks, [k]: e.target.value } })} placeholder="Ready-made template link (optional)" className="h-7 text-xs" />
                </div>
              </div>
            )
          })}
        </div>
        <Button size="sm" onClick={save} loading={busy}>Save capabilities</Button>
      </CardContent>
    </Card>
  )
}

interface Exclusion { id: string; kind: string; value: string; reason: string | null }
const KINDS: Array<[string, string, string]> = [
  ['CHANNEL', 'Channels / accounts', 'YouTube channel URL or id, HN or DEV profile URL'],
  ['NAME', 'Display names', 'Exact names or @handles'],
  ['DOMAIN', 'Domains', 'competitor.com — never emailed'],
  ['EMAIL', 'Emails', 'Specific addresses — never emailed'],
]

/** Settings → Exclusions: competitors, own staff, known engagement groups */
export function ExclusionsCard() {
  const { data, mutate } = useSWR<Exclusion[]>('/api/audience/exclusions', fetcher)
  const [kind, setKind] = useState('CHANNEL')
  const [values, setValues] = useState('')
  const [reason, setReason] = useState('')
  const list = Array.isArray(data) ? data : []

  async function add() {
    if (!values.trim()) return
    const res = await fetch('/api/audience/exclusions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, values, reason: reason || undefined }) })
    const d = await res.json()
    if (!res.ok) return toast.error(d.error || 'Could not add')
    toast.success(`${d.added} added`)
    setValues(''); mutate()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldOff className="h-4 w-4 text-slate-500" />Exclusions</CardTitle>
        <CardDescription>People and companies the Audience engine should ignore: competitors, your own team, and any group known to post coordinated or paid comments. Excluded accounts are never collected; excluded emails and domains are never emailed.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="h-9 w-48" />
        </div>
        <Textarea rows={3} value={values} onChange={(e) => setValues(e.target.value)} placeholder={`One per line: ${KINDS.find((k) => k[0] === kind)?.[2]}`} className="text-sm" />
        <Button size="sm" onClick={add}>Add to exclusions</Button>
        {list.length > 0 && (
          <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
            {list.map((e) => (
              <div key={e.id} className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-xs last:border-0">
                <span className="w-16 shrink-0 rounded bg-slate-100 px-1 text-center text-[10px] text-slate-500">{e.kind.toLowerCase()}</span>
                <span className="flex-1 truncate font-mono text-slate-700">{e.value}</span>
                {e.reason && <span className="truncate text-slate-400">{e.reason}</span>}
                <button onClick={async () => { await fetch(`/api/audience/exclusions?id=${e.id}`, { method: 'DELETE' }); mutate() }} className="text-slate-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
