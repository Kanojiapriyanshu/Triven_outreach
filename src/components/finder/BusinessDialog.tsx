'use client'
import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Star, MapPin, Phone, Globe, ExternalLink, Mail, ShieldCheck, ShieldAlert, ShieldQuestion, Trash2, RefreshCw, Ban, Undo2,
  UserRound, Clock, Sparkles, Wrench, Search, FileText, Megaphone, Plus, Crown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { TierBadge, BizStatusBadge, SOURCE_LABEL } from './badges'

const fetcher = (url: string) => fetch(url).then(async (r) => {
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'Request failed')
  return d
})

interface BizEmail {
  id: string; email: string; source: string; sourceUrl: string | null; personName: string | null; confidence: number | null
  status: string; verifyMethod: string | null; verifyDetail: string | null; isRole: boolean; isFree: boolean; isPrimary: boolean; sendable: boolean
}
interface Business {
  id: string; name: string; nicheLabel: string | null; category: string | null; source: string; address: string | null; city: string | null; state: string | null
  phone: string | null; website: string | null; mapsUrl: string | null; rating: number | null; reviewCount: number; hours: string | null
  ownerName: string | null; ownerTitle: string | null; ownerSource: string | null; linkedIn: string | null; facebook: string | null; instagram: string | null
  contactFormUrl: string | null; techSignals: string[]; siteFacts: string[]; fitScore: number; fitReasons: string[]; tier: string; status: string
  excludeReason: string | null; searchLog: string | null; enrichedAt: string | null; notes: string | null
  emails: BizEmail[]; lead: { id: string; status: string; campaign: { id: string; name: string } | null } | null
}

function EmailStatusIcon({ e }: { e: BizEmail }) {
  if (e.status === 'VERIFIED') return <ShieldCheck className="h-4 w-4 text-emerald-600" />
  if (e.status === 'INVALID') return <ShieldAlert className="h-4 w-4 text-red-500" />
  return <ShieldQuestion className={`h-4 w-4 ${e.sendable ? 'text-sky-600' : 'text-amber-500'}`} />
}

export default function BusinessDialog({ id, onClose, onChanged, onPush }: { id: string | null; onClose: () => void; onChanged: () => void; onPush: (id: string) => void }) {
  const { data: b, mutate } = useSWR<Business>(id ? `/api/finder/businesses/${id}` : null, fetcher)
  const [busy, setBusy] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [owner, setOwner] = useState<string | null>(null)

  async function patch(body: Record<string, unknown>, label: string) {
    setBusy(label)
    try {
      const res = await fetch(`/api/finder/businesses/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error || 'Could not save'); return false }
      await mutate(); onChanged()
      return true
    } finally { setBusy('') }
  }

  async function research() {
    setBusy('research')
    try {
      const res = await fetch('/api/finder/businesses/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'research', ids: [id] }) })
      const d = await res.json()
      if (!res.ok) return toast.error(d.error || 'Research failed')
      toast.success(d.ready ? 'Ready to email' : 'Research done')
      await mutate(); onChanged()
    } finally { setBusy('') }
  }

  async function remove() {
    if (!confirm('Delete this business from the Lead Finder?')) return
    await fetch(`/api/finder/businesses/${id}`, { method: 'DELETE' })
    onChanged(); onClose()
  }

  const where = [b?.city, b?.state].filter(Boolean).join(', ')

  return (
    <Dialog open={!!id} onOpenChange={(v) => { if (!v) { setOwner(null); onClose() } }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0">
        {!b ? <div className="p-10 text-center text-sm text-slate-400">Loading…</div> : (
          <>
            {/* Header */}
            <div className="border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white px-6 pt-6 pb-4">
              <DialogHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-indigo-600">{b.nicheLabel || b.category || 'Business'}</p>
                    <DialogTitle className="mt-1 text-xl">{b.name}</DialogTitle>
                    <DialogDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      {b.rating != null && <span className="inline-flex items-center gap-1 text-slate-700"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />{b.rating.toFixed(1)} <span className="text-slate-400">({b.reviewCount})</span></span>}
                      {where && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{where}</span>}
                      {b.mapsUrl && <a href={b.mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline">{b.source === 'OSM' ? 'OpenStreetMap' : 'Google Maps'}<ExternalLink className="h-3 w-3" /></a>}
                    </DialogDescription>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="flex items-center justify-end gap-2"><TierBadge tier={b.tier} /><span className="text-2xl font-semibold tabular-nums text-slate-900">{b.fitScore}</span></div>
                    <div className="mt-1"><BizStatusBadge status={b.status} /></div>
                  </div>
                </div>
              </DialogHeader>
              <div className="mt-4 flex flex-wrap gap-2">
                {b.lead ? (
                  <Button size="sm" asChild><Link href={`/leads/${b.lead.id}`}><Megaphone className="h-3.5 w-3.5" />Open lead{b.lead.campaign ? ` · ${b.lead.campaign.name}` : ''}</Link></Button>
                ) : b.status === 'READY' ? (
                  <Button size="sm" onClick={() => onPush(b.id)}><Megaphone className="h-3.5 w-3.5" />Add to campaign</Button>
                ) : null}
                {!b.lead && <Button size="sm" variant="outline" onClick={research} loading={busy === 'research'}><RefreshCw className="h-3.5 w-3.5" />Research again</Button>}
                {['EXCLUDED', 'DO_NOT_CONTACT'].includes(b.status)
                  ? <Button size="sm" variant="outline" onClick={() => patch({ status: 'RESTORE' }, 'restore')} loading={busy === 'restore'}><Undo2 className="h-3.5 w-3.5" />Restore</Button>
                  : !b.lead && <>
                    <Button size="sm" variant="outline" onClick={() => patch({ status: 'EXCLUDED' }, 'exclude')} loading={busy === 'exclude'}><Ban className="h-3.5 w-3.5" />Not a fit</Button>
                    <Button size="sm" variant="ghost" onClick={() => patch({ status: 'DO_NOT_CONTACT' }, 'dnc')} loading={busy === 'dnc'} title="Adds their emails to the suppression list">Do not contact</Button>
                  </>}
                {!b.lead && <Button size="sm" variant="ghost" className="ml-auto text-slate-400 hover:text-red-600" onClick={remove}><Trash2 className="h-3.5 w-3.5" /></Button>}
              </div>
            </div>

            <div className="grid gap-6 p-6 md:grid-cols-5">
              {/* Left: contact */}
              <div className="space-y-5 md:col-span-3">
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Mail className="h-3.5 w-3.5" />Emails</h3>
                  {b.emails.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-500">
                      {b.enrichedAt ? 'No email found anywhere. Call them, or use their contact form.' : 'Not researched yet: it runs in the background, or click Research again.'}
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                      {b.emails.map((e) => (
                        <li key={e.id} className="group flex items-start gap-2.5 px-3 py-2.5">
                          <EmailStatusIcon e={e} />
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
                              <span className="truncate">{e.email}</span>
                              {e.isPrimary && <span className="rounded bg-indigo-100 px-1 text-[10px] text-indigo-700">primary</span>}
                              {e.personName && <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-600">{e.personName}</span>}
                              {e.isRole && <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-500">front desk</span>}
                            </p>
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              {e.status.toLowerCase()}{e.verifyMethod ? ` (${e.verifyMethod.toLowerCase()})` : ''} · {SOURCE_LABEL[e.source] || e.source}
                              {e.sourceUrl && <> · <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">where</a></>}
                              {e.sendable ? <span className="text-emerald-600"> · OK to email</span> : e.status !== 'INVALID' ? <span className="text-amber-600"> · not confirmed</span> : null}
                            </p>
                            {e.verifyDetail && <p className="text-[10px] text-slate-400">{e.verifyDetail}</p>}
                          </div>
                          <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                            {!e.isPrimary && e.sendable && <button title="Use this one" onClick={() => patch({ primaryEmailId: e.id }, 'primary')} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"><Crown className="h-3.5 w-3.5" /></button>}
                            <button title="Remove" onClick={() => patch({ removeEmailId: e.id }, 'rm')} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <form className="mt-2 flex gap-2" onSubmit={async (ev) => { ev.preventDefault(); if (newEmail && await patch({ addEmail: newEmail }, 'add')) setNewEmail('') }}>
                    <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Found one yourself? Add it (it's checked)" className="h-8 text-sm" />
                    <Button size="sm" variant="outline" type="submit" loading={busy === 'add'} disabled={!newEmail}><Plus className="h-3.5 w-3.5" />Add</Button>
                  </form>
                </section>

                <section className="grid gap-2 text-sm">
                  {b.phone && <a href={`tel:${b.phone}`} className="flex items-center gap-2 text-slate-700 hover:text-indigo-600"><Phone className="h-4 w-4 text-slate-400" />{b.phone}</a>}
                  {b.website && <a href={b.website} target="_blank" rel="noreferrer" className="flex items-center gap-2 truncate text-slate-700 hover:text-indigo-600"><Globe className="h-4 w-4 text-slate-400" />{b.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a>}
                  {b.contactFormUrl && <a href={b.contactFormUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-slate-700 hover:text-indigo-600"><FileText className="h-4 w-4 text-slate-400" />Contact form</a>}
                  {b.address && <p className="flex items-start gap-2 text-slate-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />{b.address}</p>}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {([['LinkedIn', b.linkedIn], ['Facebook', b.facebook], ['Instagram', b.instagram]] as const).filter(([, u]) => u).map(([label, u]) => (
                      <a key={label} href={u!} target="_blank" rel="noreferrer" className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:border-indigo-400 hover:text-indigo-700">{label}</a>
                    ))}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><UserRound className="h-3.5 w-3.5" />Decision maker</h3>
                  {owner === null ? (
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-slate-800">{b.ownerName || <span className="text-slate-400">Unknown</span>}{b.ownerTitle && <span className="text-slate-500"> · {b.ownerTitle}</span>}
                        {b.ownerSource && <span className="block text-[11px] text-slate-400">from {b.ownerSource}</span>}</span>
                      <Button size="sm" variant="ghost" onClick={() => setOwner(b.ownerName || '')}>Edit</Button>
                    </div>
                  ) : (
                    <form className="flex gap-2" onSubmit={async (ev) => { ev.preventDefault(); if (await patch({ ownerName: owner }, 'owner')) setOwner(null) }}>
                      <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. Dr. Jane Neely" className="h-8 text-sm" autoFocus />
                      <Button size="sm" type="submit" loading={busy === 'owner'}>Save</Button>
                    </form>
                  )}
                </section>

                {b.searchLog && (
                  <section>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Search className="h-3.5 w-3.5" />Where we looked</h3>
                    <ol className="space-y-1 border-l-2 border-slate-100 pl-3">
                      {b.searchLog.split('\n').map((l, i) => <li key={i} className="text-xs text-slate-600">{l}</li>)}
                    </ol>
                  </section>
                )}
              </div>

              {/* Right: why */}
              <div className="space-y-5 md:col-span-2">
                <section className="rounded-lg bg-slate-50 p-3">
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Sparkles className="h-3.5 w-3.5" />Why this fit score</h3>
                  <ul className="space-y-1">
                    {b.fitReasons.map((r, i) => (
                      <li key={i} className="flex gap-2 text-xs">
                        <span className={`w-7 shrink-0 text-right font-semibold tabular-nums ${r.startsWith('-') ? 'text-red-600' : 'text-emerald-600'}`}>{r.split(' ')[0]}</span>
                        <span className="text-slate-600">{r.split(' ').slice(1).join(' ')}</span>
                      </li>
                    ))}
                  </ul>
                </section>
                {b.hours && (
                  <section>
                    <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Clock className="h-3.5 w-3.5" />Hours</h3>
                    <ul className="space-y-0.5 text-xs text-slate-700">{b.hours.split(', ').map((h) => <li key={h} className={/closed/.test(h) ? 'text-amber-700' : ''}>{h}</li>)}</ul>
                  </section>
                )}
                {b.siteFacts.length > 0 && (
                  <section>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">From their website</h3>
                    <div className="flex flex-wrap gap-1">{b.siteFacts.map((f) => <span key={f} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">{f}</span>)}</div>
                    <p className="mt-1 text-[10px] text-slate-400">Used to personalise the first line of the email.</p>
                  </section>
                )}
                {b.techSignals.length > 0 && (
                  <section>
                    <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Wrench className="h-3.5 w-3.5" />Tools on their site</h3>
                    <div className="flex flex-wrap gap-1">{b.techSignals.map((t) => <span key={t} className={`rounded-full px-2 py-0.5 text-[11px] ${/competitor/.test(t) ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700'}`}>{t}</span>)}</div>
                  </section>
                )}
                {b.excludeReason && <p className="text-xs text-slate-500">Excluded: {b.excludeReason}</p>}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
