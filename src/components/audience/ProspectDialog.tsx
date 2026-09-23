'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { toast } from 'sonner'
import {
  ExternalLink, Globe, Star, Ban, Trash2, RefreshCw, Plus, Send, XCircle, Search, MailCheck, Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RelevanceBadge, ProspectStatusBadge, EmailChip, Avatar, fmtNum } from './badges'
import { PERSONAS, INTERESTS, COUNTRIES, sequenceForPersona, type Persona, type Interest } from '@/lib/audience/taxonomy'
import { AI_BUILDER_SEQUENCES } from '@/lib/audience/sequences'
import { buildTemplateVars, renderTemplate } from '@/lib/template'
import { fmtRelative } from '@/lib/utils'
import { commentUrl, profileUrl, PLATFORM_LABEL } from '@/lib/audience/links'
import { flag } from '@/lib/audience/country'

const fetcher = (url: string) => fetch(url).then(async (r) => {
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'Request failed')
  return d
})

interface Detail {
  id: string; youtubeChannelId: string; displayName: string; firstName: string | null; lastName: string | null; handle: string | null
  avatarUrl: string | null; channelDescription: string | null; subscriberCount: number; videoCount: number; country: string | null
  company: string | null; jobTitle: string | null; website: string | null; linkedIn: string | null; twitter: string | null; github: string | null
  otherLinks: string[]; location: string | null; bio: string | null; persona: string | null; interestCategory: string | null
  relevance: string; score: number; reason: string | null; topic: string | null; icebreaker: string | null; status: string
  consentSensitive: boolean; enrichedAt: string | null; enrichNotes: string | null; aiCheckedAt: string | null; firstSeenAt: string
  emails: Array<{ id: string; email: string; source: string; sourceUrl: string | null; status: string; verifyMethod: string | null; verifyDetail: string | null; isPrimary: boolean; isRole: boolean; isFree: boolean; confidence: number | null }>
  comments: Array<{ id: string; youtubeCommentId: string; text: string; relevance: string; score: number; signals: string[]; likeCount: number; publishedAt: string | null; video: { title: string; youtubeVideoId: string; platform: string; channel: { title: string } } }>
  lead: { id: string; status: string; firstEmailSentAt: string | null; hasReplied: boolean; campaign: { id: string; name: string } | null } | null
  sendableEmailId: string | null
  platform: string; profileUrl: string | null; countrySource: string | null; countryConfidence: number
  readinessGap: string | null
  intentScore: number; intentEvidence: string[]; identityScore: number; ownChannelSummary: string | null; ownChannelAi: boolean
  deepReadAt: string | null; webSearchedAt: string | null; finderCheckedAt: string | null
}

const SOURCE_LABEL: Record<string, string> = {
  CHANNEL: 'their profile bio', CHANNEL_VIDEO: 'their own video description', COMMENT: 'their comment', WEBSITE: 'their website',
  LINK_PAGE: 'link-in-bio page', HUNTER: 'Hunter', APOLLO: 'Apollo', PATTERN: 'name pattern (verified)', MANUAL: 'added by hand',
  GITHUB: 'GitHub profile (no longer used)',
}

export default function ProspectDialog({ id, onClose, onChanged, onPush }: { id: string | null; onClose: () => void; onChanged: () => void; onPush: (id: string) => void }) {
  const { data: p, mutate } = useSWR<Detail>(id ? `/api/audience/prospects/${id}` : null, fetcher)
  const { data: me } = useSWR<{ user?: { name?: string } }>('/api/auth/me', fetcher)
  const [newEmail, setNewEmail] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [edit, setEdit] = useState({ topic: '', icebreaker: '', company: '', jobTitle: '', firstName: '' })
  useEffect(() => {
    if (p && 'id' in p) setEdit({ topic: p.topic || '', icebreaker: p.icebreaker || '', company: p.company || '', jobTitle: p.jobTitle || '', firstName: p.firstName || '' })
  }, [p])

  const changed = () => { mutate(); onChanged() }

  async function patch(data: Record<string, unknown>, msg = 'Saved') {
    const res = await fetch(`/api/audience/prospects/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(d.error || 'Could not save')
    toast.success(msg)
    changed()
  }

  async function bulk(action: string, label: string) {
    setBusy(action)
    try {
      const res = await fetch('/api/audience/prospects/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ids: [id] }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(d.error || 'Failed')
      toast.success(label)
      changed()
    } finally { setBusy(null) }
  }

  async function emailAction(emailId: string, body: Record<string, unknown> | null) {
    const res = await fetch(`/api/audience/emails/${emailId}`, body ? { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method: 'DELETE' })
    if (!res.ok) return toast.error('Could not update the email')
    changed()
  }

  async function addEmail() {
    if (!newEmail.trim()) return
    setBusy('email')
    try {
      const res = await fetch(`/api/audience/prospects/${id}/emails`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: newEmail }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(d.error || 'Could not add')
      setNewEmail('')
      toast.success('Added and checked')
      changed()
    } finally { setBusy(null) }
  }

  async function forget() {
    if (!confirm('Delete this person, their comments and any CRM lead? Their email addresses stay on the do-not-contact list so they are never emailed again.')) return
    await fetch(`/api/audience/prospects/${id}`, { method: 'DELETE' })
    toast.success('Deleted')
    onChanged()
    onClose()
  }

  // What their first email would look like
  const preview = useMemo(() => {
    if (!p || !('id' in p)) return null
    const seq = AI_BUILDER_SEQUENCES.find((s) => s.id === sequenceForPersona(p.persona))!
    const best = p.comments[0]
    const lead = {
      firstName: p.firstName, lastName: p.lastName, companyName: p.company || '', companyEmail: p.emails.find((e) => e.id === p.sendableEmailId)?.email || null,
      industry: 'AI Builder', personalizationNotes: p.icebreaker, sourcePlatform: p.platform, sourceChannel: best?.video.channel.title, sourceVideo: best?.video.title,
      commentTopic: p.topic, interestCategory: p.interestCategory, persona: p.persona,
    }
    const vars = buildTemplateVars(lead, { displayName: me?.user?.name || 'You' })
    return { campaign: seq.niche, subject: renderTemplate(seq.steps[0].subject, vars), body: renderTemplate(seq.steps[0].body, vars) }
  }, [p, me])

  const name = p && 'id' in p ? (p.firstName ? [p.firstName, p.lastName].filter(Boolean).join(' ') : p.displayName) : ''

  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl">
        {!p || !('id' in p) ? <div className="h-64 animate-pulse rounded-lg bg-slate-50" /> : (
          <div className="space-y-5">
            <DialogHeader>
              <div className="flex items-start gap-3 pr-8">
                <Avatar src={p.avatarUrl} name={p.displayName} size={48} />
                <div className="min-w-0 flex-1">
                  <DialogTitle className="flex flex-wrap items-center gap-2">
                    {name}
                    <RelevanceBadge value={p.relevance} score={p.score} />
                    <ProspectStatusBadge status={p.status} leadStatus={p.lead?.status} />
                    {p.consentSensitive && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800" title="EU/UK/CA/AU/NZ: only self-published addresses are used">stricter rules</span>}
                  </DialogTitle>
                  <p className="text-xs text-slate-500 mt-1">
                    <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{PLATFORM_LABEL[p.platform] || p.platform}</span>
                    <a href={profileUrl(p)} target="_blank" rel="noreferrer" className="hover:text-indigo-600">{p.handle || p.displayName} <ExternalLink className="inline h-3 w-3" /></a>
                    {p.subscriberCount > 0 && <> · {fmtNum(p.subscriberCount)} subscribers</>}
                    {p.country && <> · <span title={`From ${(p.countrySource || '').toLowerCase()}, ${p.countryConfidence}% sure`}>{flag(p.country)} {COUNTRIES[p.country]?.name || p.country}{p.countryConfidence && p.countryConfidence < 70 ? ' (likely)' : ''}</span></>}
                    {p.location && <> · {p.location}</>}
                    {' '}· first seen {fmtRelative(p.firstSeenAt)}
                  </p>
                  {p.reason && <p className="text-xs text-slate-600 mt-1.5">{p.reason}</p>}
                  {!p.lead && (
                    <p className={`mt-1.5 text-xs font-medium ${p.readinessGap ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {p.readinessGap ? `Not ready: ${p.readinessGap}` : 'Ready to contact'}
                    </p>
                  )}
                </div>
              </div>
            </DialogHeader>

            <div className="grid gap-5 md:grid-cols-2">
              {/* Left: classification + personalisation */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-slate-500">Persona
                    <select value={p.persona || ''} onChange={(e) => patch({ persona: e.target.value || null }, 'Persona updated')} className="mt-1 h-8 w-full rounded-lg border border-slate-300 px-2 text-sm text-slate-800">
                      <option value="">Not clear</option>
                      {Object.entries(PERSONAS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-slate-500">Interest
                    <select value={p.interestCategory || ''} onChange={(e) => patch({ interestCategory: e.target.value || null }, 'Interest updated')} className="mt-1 h-8 w-full rounded-lg border border-slate-300 px-2 text-sm text-slate-800">
                      <option value="">Not clear</option>
                      {Object.entries(INTERESTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-[11px] text-slate-500">Buying intent</p>
                    <p className="text-lg font-semibold text-slate-900">{p.intentScore}<span className="text-xs font-normal text-slate-400">/100</span></p>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2" title="Site +40, LinkedIn +20, company +15, full name +15, own channel +10">
                    <p className="text-[11px] text-slate-500">Identity</p>
                    <p className="text-lg font-semibold text-slate-900">{p.identityScore}<span className="text-xs font-normal text-slate-400">/100</span></p>
                  </div>
                </div>
                {p.intentEvidence.filter((e) => e !== 'No buying signals').length > 0 && (
                  <ul className="space-y-0.5">
                    {p.intentEvidence.filter((e) => e !== 'No buying signals').map((e) => <li key={e} className="text-xs text-emerald-800">✓ {e}</li>)}
                  </ul>
                )}
                {p.ownChannelSummary && <p className="text-xs text-slate-600">Their channel: {p.ownChannelSummary}</p>}
                <p className="text-[11px] text-slate-400">
                  Own channel read {p.deepReadAt ? fmtRelative(p.deepReadAt) : 'no'} · web search {p.webSearchedAt ? fmtRelative(p.webSearchedAt) : 'no'} · email finders {p.finderCheckedAt ? fmtRelative(p.finderCheckedAt) : 'no'}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(['HIGH', 'MEDIUM', 'LOW', 'SPAM'] as const).map((r) => (
                    <button key={r} onClick={() => fetch('/api/audience/prospects/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'setRelevance', ids: [p.id], relevance: r }) }).then(changed)}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${p.relevance === r ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-300 text-slate-600 hover:border-slate-500'}`}>{r.toLowerCase()}</button>
                  ))}
                  <span className="text-[11px] text-slate-400 self-center">{p.aiCheckedAt ? 'reviewed' : 'rules only'}</span>
                </div>

                <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" />Personalisation</p>
                  <label className="block text-xs text-slate-500">First name (greeting)
                    <Input value={edit.firstName} onChange={(e) => setEdit((x) => ({ ...x, firstName: e.target.value }))} placeholder="empty = &quot;Hi there&quot;" className="mt-1 h-8" />
                  </label>
                  <label className="block text-xs text-slate-500">Their comment was about…
                    <Input value={edit.topic} onChange={(e) => setEdit((x) => ({ ...x, topic: e.target.value }))} placeholder="building voice agents for clinics" className="mt-1 h-8" />
                  </label>
                  <label className="block text-xs text-slate-500">Personal line (optional)
                    <Textarea value={edit.icebreaker} onChange={(e) => setEdit((x) => ({ ...x, icebreaker: e.target.value }))} rows={2} placeholder="One sentence that responds to what they said" className="mt-1 text-sm" />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={edit.company} onChange={(e) => setEdit((x) => ({ ...x, company: e.target.value }))} placeholder="Company" className="h-8" />
                    <Input value={edit.jobTitle} onChange={(e) => setEdit((x) => ({ ...x, jobTitle: e.target.value }))} placeholder="Job title" className="h-8" />
                  </div>
                  <Button size="sm" variant="outline" onClick={() => patch({ topic: edit.topic || null, icebreaker: edit.icebreaker || null, company: edit.company || null, jobTitle: edit.jobTitle || null, firstName: edit.firstName || null })}>Save</Button>
                </div>

                {/* Profile */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-slate-500 uppercase">Profile</p>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {p.website && <a href={p.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 hover:border-indigo-400"><Globe className="h-3 w-3" />{p.website.replace(/^https?:\/\//, '')}</a>}
                    {p.linkedIn && <a href={p.linkedIn} target="_blank" rel="noreferrer" className="rounded-md border border-slate-200 px-2 py-0.5 hover:border-indigo-400">LinkedIn</a>}
                    {p.github && <a href={`https://github.com/${p.github}`} target="_blank" rel="noreferrer" className="rounded-md border border-slate-200 px-2 py-0.5 hover:border-indigo-400">GitHub</a>}
                    {p.twitter && <a href={p.twitter} target="_blank" rel="noreferrer" className="rounded-md border border-slate-200 px-2 py-0.5 hover:border-indigo-400">X</a>}
                    {p.otherLinks.slice(0, 6).map((l) => <a key={l} href={l} target="_blank" rel="noreferrer" className="rounded-md border border-slate-200 px-2 py-0.5 text-slate-500 hover:border-indigo-400 max-w-[180px] truncate">{l.replace(/^https?:\/\/(www\.)?/, '')}</a>)}
                    {!p.website && !p.linkedIn && (
                      <a href={`https://www.google.com/search?q=${encodeURIComponent(`${name} ${p.company || ''} linkedin`)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-slate-500 hover:border-indigo-400"><Search className="h-3 w-3" />Look up by hand</a>
                    )}
                  </div>
                  {(p.channelDescription || p.bio) && <p className="text-xs text-slate-600 whitespace-pre-wrap line-clamp-5">{p.channelDescription || p.bio}</p>}
                  {p.enrichNotes && <p className="text-[11px] text-slate-400 whitespace-pre-wrap">{p.enrichNotes}</p>}
                  <Button size="sm" variant="ghost" onClick={() => bulk('enrich', 'Research finished')} loading={busy === 'enrich'}><RefreshCw className="h-3.5 w-3.5" />{p.enrichedAt ? 'Research again' : 'Research now'}</Button>
                </div>
              </div>

              {/* Right: emails + preview */}
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-slate-500 uppercase">Emails</p>
                  {p.emails.length === 0 && <p className="text-xs text-slate-400">{p.enrichedAt ? 'No public address found. Add one if you find it elsewhere.' : 'Not researched yet.'}</p>}
                  {p.emails.map((e) => (
                    <div key={e.id} className={`rounded-lg border p-2 ${e.id === p.sendableEmailId ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <EmailChip email={e.email} status={e.status} primary={e.isPrimary} />
                        <div className="flex shrink-0 gap-0.5">
                          {!e.isPrimary && e.status !== 'INVALID' && <button onClick={() => emailAction(e.id, { isPrimary: true })} title="Use this one" className="p-1 text-slate-400 hover:text-amber-500"><Star className="h-3.5 w-3.5" /></button>}
                          <button onClick={() => emailAction(e.id, { status: 'RECHECK' }).then(() => bulk('verify', 'Checked'))} title="Check again" className="p-1 text-slate-400 hover:text-indigo-600"><MailCheck className="h-3.5 w-3.5" /></button>
                          {e.status !== 'INVALID' && <button onClick={() => emailAction(e.id, { status: 'INVALID' })} title="Mark invalid" className="p-1 text-slate-400 hover:text-red-500"><XCircle className="h-3.5 w-3.5" /></button>}
                          <button onClick={() => emailAction(e.id, null)} title="Remove" className="p-1 text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        From {e.sourceUrl ? <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="underline">{SOURCE_LABEL[e.source] || e.source}</a> : SOURCE_LABEL[e.source] || e.source}
                        {e.isRole && ' · shared inbox'}{e.isFree ? ' · personal mail' : ' · business domain'}
                        {e.confidence ? ` · confidence ${e.confidence}` : ''}
                        {e.verifyDetail && <> · {e.verifyDetail}</>}
                        {e.id === p.sendableEmailId && <span className="text-emerald-700 font-medium"> · will be used</span>}
                      </p>
                    </div>
                  ))}
                  <div className="flex gap-1.5">
                    <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addEmail()} placeholder="Add an address" className="h-8" />
                    <Button size="sm" variant="outline" onClick={addEmail} loading={busy === 'email'}><Plus className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>

                {preview && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase">First email preview <span className="font-normal normal-case">· {preview.campaign}</span></p>
                    <p className="text-sm font-medium text-slate-800 mt-1.5">{preview.subject}</p>
                    <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed mt-1 max-h-72 overflow-y-auto">{preview.body}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Comments */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase">Comments ({p.comments.length})</p>
              <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                {p.comments.map((c) => (
                  <div key={c.id} className="rounded-lg border border-slate-100 p-2.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                      <RelevanceBadge value={c.relevance} score={c.score} />
                      <a href={commentUrl(c.video.platform, c.video.youtubeVideoId, c.youtubeCommentId)} target="_blank" rel="noreferrer" className="hover:text-indigo-600 truncate max-w-[420px]">{c.video.channel.title} · {c.video.title} <ExternalLink className="inline h-3 w-3" /></a>
                      {c.likeCount > 0 && <span>· {c.likeCount} likes</span>}
                      {c.signals.filter((s) => s !== 'generic').map((s) => <span key={s} className="rounded bg-slate-100 px-1">{s.replace(/_/g, ' ')}</span>)}
                    </div>
                    <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap">{c.text}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" className="text-slate-500" onClick={() => bulk('dnc', 'Marked do-not-contact')} loading={busy === 'dnc'}><Ban className="h-3.5 w-3.5" />Do not contact</Button>
                <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600" onClick={forget}><Trash2 className="h-3.5 w-3.5" />Delete &amp; forget</Button>
              </div>
              {p.lead ? (
                <Button size="sm" variant="outline" asChild><Link href={`/leads/${p.lead.id}`}>Open lead{p.lead.campaign ? ` · ${p.lead.campaign.name}` : ''}<ExternalLink className="h-3.5 w-3.5" /></Link></Button>
              ) : (
                <Button size="sm" onClick={() => onPush(p.id)} disabled={p.status !== 'READY_TO_CONTACT'} title={p.status !== 'READY_TO_CONTACT' ? 'Needs a relevant rating and an email that passes your rules' : undefined}>
                  <Send className="h-3.5 w-3.5" />Add to campaign
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
