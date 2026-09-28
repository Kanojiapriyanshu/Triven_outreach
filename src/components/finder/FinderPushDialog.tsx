'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Route, Megaphone, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { nicheOf } from '@/lib/finder/niches'

const fetcher = (url: string) => fetch(url).then(async (r) => {
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'Request failed')
  return d
})

interface Result { added: number; skipped: Array<{ id: string; name: string; reason: string }>; byCampaign: Record<string, number> }

/** Businesses → campaign leads. Routed by niche to the campaign with the matching sequence. */
export default function FinderPushDialog({ open, onOpenChange, ids, filter, count, niches, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; ids?: string[]; filter?: string; count: number; niches: string[]; onDone: () => void
}) {
  const { data: campaigns, mutate: mutateCampaigns } = useSWR<Array<{ id: string; name: string; industry: string; sendingStatus: string }>>(open ? '/api/campaigns' : null, fetcher)
  const [mode, setMode] = useState<'niche' | 'one'>('niche')
  const [campaignId, setCampaignId] = useState('')
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const list = Array.isArray(campaigns) ? campaigns : []
  const routes = niches.map((id) => {
    const n = nicheOf(id)
    const c = n ? list.find((x) => [n.label, n.id, n.query].some((v) => v.toLowerCase() === x.industry.toLowerCase())) : null
    return { id, label: n?.label || 'Custom search', campaign: c }
  })
  const missing = routes.filter((r) => !r.campaign && nicheOf(r.id))

  async function createFor(nicheId: string) {
    setCreating(nicheId)
    try {
      const res = await fetch('/api/finder/campaign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ niche: nicheId }) })
      const d = await res.json()
      if (!res.ok) return toast.error(d.error || 'Could not create the campaign')
      toast.success(`Campaign "${d.name}" created with its 4-step sequence (draft)`)
      await mutateCampaigns()
    } finally { setCreating('') }
  }

  async function push() {
    setBusy(true)
    try {
      const res = await fetch('/api/finder/businesses/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push', ids, filter, ...(mode === 'niche' ? { byNiche: true } : { campaignId }) }),
      })
      const d = await res.json()
      if (!res.ok) return toast.error(d.error || 'Could not add to campaign')
      setResult(d)
      if (d.added) toast.success(`${d.added} added. They go out when the campaign is launched.`)
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
            {count.toLocaleString('en-US')} selected. Only businesses with an email that passes your rules are added; each email is personalised from their hours, reviews and website.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-slate-800"><CheckCircle2 className="h-4 w-4 text-emerald-600" />{result.added} added{result.skipped.length ? `, ${result.skipped.length} skipped` : ''}.</p>
            {Object.entries(result.byCampaign).map(([n, c]) => <p key={n} className="text-slate-600">{n}: <strong>{c}</strong></p>)}
            {reasons.length > 0 && (
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Skipped</p>
                {reasons.map(([r, c]) => <p key={r} className="text-xs text-slate-600">{c} × {r}</p>)}
              </div>
            )}
            <p className="text-xs text-slate-500">
              Review the sequence and launch it on the <Link href="/campaigns" className="text-indigo-600 hover:underline">Campaigns</Link> page. Replies are detected and follow-ups stop on their own.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <label className={`flex gap-2.5 rounded-lg border p-3 cursor-pointer ${mode === 'niche' ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200'}`}>
              <input type="radio" checked={mode === 'niche'} onChange={() => setMode('niche')} className="mt-1" />
              <span className="flex-1">
                <span className="text-sm font-medium text-slate-800 flex items-center gap-1.5"><Route className="h-4 w-4 text-indigo-600" />Route by niche (recommended)</span>
                <span className="block text-xs text-slate-500 mt-0.5">Dentists go to the dental campaign, plumbers to home services, and so on: each gets the sequence written for it.</span>
                <span className="mt-2 block space-y-1">
                  {routes.map((r) => (
                    <span key={r.id} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="text-slate-600">{r.label} →{' '}
                        <span className={r.campaign ? 'font-medium text-slate-800' : 'text-amber-600'}>{r.campaign ? r.campaign.name : 'no campaign yet'}</span>
                        {r.campaign && r.campaign.sendingStatus !== 'ACTIVE' && <span className="ml-1 text-[10px] text-slate-400">({r.campaign.sendingStatus.toLowerCase()})</span>}
                      </span>
                      {!r.campaign && nicheOf(r.id) && (
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" loading={creating === r.id} onClick={(e) => { e.preventDefault(); createFor(r.id) }}>
                          <Megaphone className="h-3 w-3" />Create
                        </Button>
                      )}
                    </span>
                  ))}
                </span>
              </span>
            </label>
            <label className={`flex gap-2.5 rounded-lg border p-3 cursor-pointer ${mode === 'one' ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200'}`}>
              <input type="radio" checked={mode === 'one'} onChange={() => setMode('one')} className="mt-1" />
              <span className="flex-1">
                <span className="text-sm font-medium text-slate-800">One campaign for all</span>
                <select value={campaignId} onChange={(e) => { setCampaignId(e.target.value); setMode('one') }} className="mt-2 h-9 w-full rounded-lg border border-slate-300 px-2 text-sm">
                  <option value="">Choose a campaign…</option>
                  {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </span>
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>{result ? 'Close' : 'Cancel'}</Button>
          {!result && (
            <Button onClick={push} loading={busy} disabled={mode === 'one' ? !campaignId : routes.every((r) => !r.campaign)}>
              Add to campaign{mode === 'niche' && missing.length ? ` (${missing.length} niche${missing.length === 1 ? '' : 's'} skipped)` : ''}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
