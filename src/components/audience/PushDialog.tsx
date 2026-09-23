'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Route, Megaphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { PERSONAS, type Persona } from '@/lib/audience/taxonomy'

const fetcher = (url: string) => fetch(url).then(async (r) => {
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'Request failed')
  return d
})

interface Preset { key: string; name: string; personas: string[]; id: string | null }
interface Result { added: number; skipped: Array<{ id: string; name: string; reason: string }>; byCampaign: Record<string, number> }

/** Push prospects into campaigns. Only outreach-ready people go in; the rest come back with a reason. */
export default function PushDialog({ open, onOpenChange, ids, filter, count, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; ids?: string[]; filter?: string; count: number; onDone: () => void
}) {
  const { data: presets, mutate: mutatePresets } = useSWR<Preset[]>(open ? '/api/audience/campaigns' : null, fetcher)
  const { data: campaigns } = useSWR<Array<{ id: string; name: string }>>(open ? '/api/campaigns' : null, fetcher)
  const [mode, setMode] = useState<'route' | 'one'>('route')
  const [campaignId, setCampaignId] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const missing = (presets || []).filter((p) => !p.id)

  async function createPresets() {
    const res = await fetch('/api/audience/campaigns', { method: 'POST' })
    if (res.ok) { toast.success('AI Builder campaigns created'); mutatePresets() }
  }

  async function push() {
    setBusy(true)
    try {
      const res = await fetch('/api/audience/prospects/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push', ids, filter, ...(mode === 'route' ? { byPersona: true } : { campaignId }) }),
      })
      const d = await res.json()
      if (!res.ok) return toast.error(d.error || 'Could not add to campaign')
      setResult(d)
      if (d.added) toast.success(`${d.added} added. They're queued and go out when the campaign is launched.`)
      onDone()
    } finally { setBusy(false) }
  }

  function close(v: boolean) {
    if (!v) setResult(null)
    onOpenChange(v)
  }

  const reasons = result ? Object.entries(result.skipped.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.reason]: (acc[s.reason] || 0) + 1 }), {})) : []

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to campaign</DialogTitle>
          <DialogDescription>
            {count.toLocaleString('en-US')} selected. Only people who are ready to contact (relevant, with an email that passes your verification and country rules) are added.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 text-sm">
            <p className="font-medium text-slate-800">{result.added} added{result.skipped.length ? `, ${result.skipped.length} skipped` : ''}.</p>
            {Object.entries(result.byCampaign).map(([n, c]) => <p key={n} className="text-slate-600">{n}: <strong>{c}</strong></p>)}
            {reasons.length > 0 && (
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Skipped</p>
                {reasons.map(([r, c]) => <p key={r} className="text-xs text-slate-600">{c} × {r}</p>)}
              </div>
            )}
            <p className="text-xs text-slate-500">Launch the campaigns on the Campaigns page when you&apos;re ready. Replies are detected and sequences stop on their own.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <label className={`flex gap-2.5 rounded-lg border p-3 cursor-pointer ${mode === 'route' ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200'}`}>
              <input type="radio" checked={mode === 'route'} onChange={() => setMode('route')} className="mt-1" />
              <span className="flex-1">
                <span className="text-sm font-medium text-slate-800 flex items-center gap-1.5"><Route className="h-4 w-4 text-indigo-600" />Route by persona (recommended)</span>
                <span className="block text-xs text-slate-500 mt-0.5">Each person goes to the AI Builder campaign whose emails fit them.</span>
                <span className="mt-2 block space-y-0.5">
                  {(presets || []).map((p) => (
                    <span key={p.key} className="block text-[11px] text-slate-500">
                      {p.personas.map((x) => PERSONAS[x as Persona]?.label).join(', ')} → <span className={p.id ? 'text-slate-700' : 'text-amber-600'}>{p.name.replace('AI Builder — ', '')}{p.id ? '' : ' (missing)'}</span>
                    </span>
                  ))}
                </span>
                {missing.length > 0 && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={(e) => { e.preventDefault(); createPresets() }}><Megaphone className="h-3.5 w-3.5" />Create missing campaigns</Button>
                )}
              </span>
            </label>
            <label className={`flex gap-2.5 rounded-lg border p-3 cursor-pointer ${mode === 'one' ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200'}`}>
              <input type="radio" checked={mode === 'one'} onChange={() => setMode('one')} className="mt-1" />
              <span className="flex-1">
                <span className="text-sm font-medium text-slate-800">One campaign for everyone</span>
                <select value={campaignId} onChange={(e) => { setCampaignId(e.target.value); setMode('one') }} className="mt-2 h-9 w-full rounded-lg border border-slate-300 px-2 text-sm">
                  <option value="">Choose a campaign…</option>
                  {(Array.isArray(campaigns) ? campaigns : []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </span>
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>{result ? 'Close' : 'Cancel'}</Button>
          {!result && <Button onClick={push} loading={busy} disabled={mode === 'one' ? !campaignId : !(presets || []).some((p) => p.id)}>Add to campaign</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
