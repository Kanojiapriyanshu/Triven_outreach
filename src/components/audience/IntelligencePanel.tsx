'use client'
import { useEffect, useState } from 'react'
import { ExternalLink, ShieldAlert, Target, Hand } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { USE_CASES, FOR_WHOM, BUILD_STAGES } from '@/lib/audience/usecases'

export interface Intel {
  id: string
  intentScore: number; fitScore: number; reachability: number; identityScore: number; opportunityScore: number
  fitReasons: string[]; useCase: string | null; useCaseDetail: string | null; forWhom: string | null; buildStage: string | null
  blocker: string | null; vertical: string | null; useCaseSource: string | null; whyTriven: string | null; outreachAngle: string | null
  aiCitations: Array<{ ref: string; text: string; url: string | null }> | null
  evidence: Array<{ id: string; type: string; weight: number; text: string; sourceUrl: string | null; createdBy: string }>
  discoveryStage: string; inauthentic: boolean; lastEngagedAt: string | null; warmTouch: string | null
  firstSource: { title: string; url: string | null; channel: { title: string } } | null
  sendableEmailId: string | null
}

const TYPE_LABEL: Record<string, string> = {
  SELF_BUILDING: 'building', FOR_CLIENTS: 'for clients', OWNS_BUSINESS: 'business', ASKED_HOW_TO: 'asked how', NAMED_TOOL: 'tools',
  NAMED_BLOCKER: 'blocker', REPEAT_ENGAGEMENT: 'repeat', OWN_AI_CONTENT: 'own content', SITE_OFFERS_AI: 'offers AI', JOB_TITLE: 'title',
  BUDGET_SIGNAL: 'budget', NEGATIVE: 'negative',
}

const STAGE_LABEL: Record<string, string> = {
  COLLECTED: 'Collected', QUALIFIED: 'Qualified', RESEARCHED: 'Researched', IDENTITY_CONFIRMED: 'Identity confirmed', EMAIL_CANDIDATES: 'Email candidates',
  VERIFIED: 'Verified', READY: 'Ready', CONTACTED: 'Contacted', NOT_QUALIFIED: 'Not qualified', UNREACHABLE: 'Unreachable',
  SUSPECTED_INAUTHENTIC: 'Suspected paid engagement', DO_NOT_CONTACT: 'Do not contact',
}

function Score({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2.5 py-1.5" title={hint}>
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className={`text-base font-semibold tabular-nums ${value >= 60 ? 'text-emerald-700' : value >= 35 ? 'text-slate-900' : 'text-slate-400'}`}>{value}</p>
    </div>
  )
}

export default function IntelligencePanel({ p, onPatch }: { p: Intel; onPatch: (body: Record<string, unknown>, msg?: string) => Promise<unknown> }) {
  const [edit, setEdit] = useState(false)
  const [u, setU] = useState({ useCase: '', useCaseDetail: '', forWhom: '', buildStage: '', blocker: '', vertical: '' })
  useEffect(() => {
    setU({ useCase: p.useCase || '', useCaseDetail: p.useCaseDetail || '', forWhom: p.forWhom || '', buildStage: p.buildStage || '', blocker: p.blocker || '', vertical: p.vertical || '' })
  }, [p])
  const fresh = p.lastEngagedAt ? Math.round((Date.now() - new Date(p.lastEngagedAt).getTime()) / 86_400_000) : null
  const cites = new Map((p.aiCitations || []).map((c) => [c.ref, c]))
  const whyParts = (p.whyTriven || '').split(/(\[E\d+\])/)

  return (
    <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/30 p-3">
      {p.inauthentic && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 p-2 text-xs text-red-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">Most of this person's comments look coordinated or paid (same accounts, same wording, instant comments). They won't be contacted.</span>
          <button onClick={() => onPatch({ inauthentic: false }, 'Marked as genuine')} className="shrink-0 underline">Not paid</button>
        </div>
      )}
      <div className="flex items-center gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700">Opportunity</p>
          <p className="text-3xl font-semibold tabular-nums text-slate-900">{p.opportunityScore}</p>
        </div>
        <div className="grid flex-1 grid-cols-4 gap-1.5">
          <Score label="Intent" value={p.intentScore} hint="Wants to build or buy now" />
          <Score label="Fit" value={p.fitScore} hint="Triven suits what they build" />
          <Score label="Reach" value={p.reachability} hint="Confidence of the best usable email" />
          <Score label="Identity" value={p.identityScore} hint="How sure we are who they are" />
        </div>
      </div>
      <p className="text-[11px] text-slate-500">
        Stage: <strong className="text-slate-700">{STAGE_LABEL[p.discoveryStage] || p.discoveryStage}</strong>
        {fresh !== null && <> · last active {fresh === 0 ? 'today' : `${fresh} day${fresh === 1 ? '' : 's'} ago`}{fresh <= 14 && <span className="text-emerald-700"> (fresh)</span>}</>}
        {p.firstSource && <> · first seen on {p.firstSource.url ? <a href={p.firstSource.url} target="_blank" rel="noreferrer" className="underline">{p.firstSource.channel.title}</a> : p.firstSource.channel.title}</>}
      </p>

      {/* Use case */}
      <div className="rounded-lg bg-white p-2.5">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500"><Target className="h-3 w-3" />What they're building <span className="font-normal normal-case text-slate-400">· {p.useCaseSource === 'MANUAL' ? 'set by you' : p.useCaseSource === 'AI' ? 'AI' : 'rules'}</span></p>
          <button onClick={() => setEdit((v) => !v)} className="text-[11px] text-indigo-600 hover:underline">{edit ? 'Cancel' : 'Correct'}</button>
        </div>
        {!edit ? (
          <div className="mt-1 text-sm text-slate-800">
            <p><strong>{p.useCase && p.useCase !== 'UNKNOWN' ? USE_CASES[p.useCase as keyof typeof USE_CASES]?.label : 'Not clear yet'}</strong>{p.useCaseDetail ? ` · ${p.useCaseDetail}` : ''}</p>
            <p className="text-xs text-slate-500">{[p.forWhom && p.forWhom !== 'UNKNOWN' && FOR_WHOM[p.forWhom as keyof typeof FOR_WHOM], p.buildStage && BUILD_STAGES[p.buildStage as keyof typeof BUILD_STAGES], p.vertical].filter(Boolean).join(' · ')}</p>
            {p.blocker && <p className="mt-0.5 text-xs text-amber-800">Blocker: "{p.blocker}"</p>}
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <select value={u.useCase} onChange={(e) => setU({ ...u, useCase: e.target.value })} className="h-8 rounded-lg border border-slate-300 px-2 text-xs">{Object.entries(USE_CASES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
            <select value={u.forWhom} onChange={(e) => setU({ ...u, forWhom: e.target.value })} className="h-8 rounded-lg border border-slate-300 px-2 text-xs"><option value="">For whom?</option>{Object.entries(FOR_WHOM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select value={u.buildStage} onChange={(e) => setU({ ...u, buildStage: e.target.value })} className="h-8 rounded-lg border border-slate-300 px-2 text-xs"><option value="">Stage?</option>{Object.entries(BUILD_STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <Input value={u.vertical} onChange={(e) => setU({ ...u, vertical: e.target.value })} placeholder="Industry (e.g. dental)" className="h-8 text-xs" />
            <Input value={u.useCaseDetail} onChange={(e) => setU({ ...u, useCaseDetail: e.target.value })} placeholder="In a few words" className="col-span-2 h-8 text-xs" />
            <Input value={u.blocker} onChange={(e) => setU({ ...u, blocker: e.target.value })} placeholder="What's blocking them (used in the email)" className="col-span-2 h-8 text-xs" />
            <Button size="sm" className="col-span-2" onClick={async () => { await onPatch({ ...Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v || null])) }, 'Use case saved'); setEdit(false) }}>Save</Button>
          </div>
        )}
      </div>

      {/* Why Triven */}
      {p.whyTriven && (
        <div className="rounded-lg bg-white p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Why Triven</p>
          <p className="mt-1 text-sm text-slate-800">
            {whyParts.map((part, i) => {
              const c = cites.get(part.replace(/[[\]]/g, ''))
              return /^\[E\d+\]$/.test(part)
                ? <span key={i} title={c?.text || ''} className="mx-0.5 cursor-help rounded bg-indigo-100 px-1 text-[10px] font-semibold text-indigo-700">{part.slice(1, -1)}</span>
                : <span key={i}>{part}</span>
            })}
          </p>
          {p.outreachAngle && <p className="mt-1 text-xs text-slate-600"><strong>Angle:</strong> {p.outreachAngle}</p>}
          {!!cites.size && (
            <ul className="mt-1.5 space-y-0.5">
              {[...cites.values()].map((c) => <li key={c.ref} className="text-[11px] text-slate-500"><strong>{c.ref}</strong> {c.text}{c.url && <a href={c.url} target="_blank" rel="noreferrer" className="ml-1 text-indigo-600"><ExternalLink className="inline h-3 w-3" /></a>}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Evidence */}
      {p.evidence.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Evidence ({p.evidence.length})</p>
          <ul className="mt-1 space-y-1">
            {p.evidence.map((e) => (
              <li key={e.id} className="flex gap-2 text-xs">
                <span className={`w-7 shrink-0 text-right font-semibold tabular-nums ${e.weight < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{e.weight > 0 ? '+' : ''}{e.weight}</span>
                <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-500">{TYPE_LABEL[e.type] || e.type}</span>
                <span className="text-slate-700">{e.text}{e.sourceUrl && <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="ml-1 text-indigo-600"><ExternalLink className="inline h-3 w-3" /></a>}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {p.fitReasons.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-500">Why fit is {p.fitScore}</summary>
          <ul className="mt-1 space-y-0.5 pl-1">{p.fitReasons.map((r) => <li key={r} className={r.startsWith('-') ? 'text-red-700' : 'text-slate-600'}>{r}</li>)}</ul>
        </details>
      )}

      {/* Warm touch: high fit, no email */}
      {!p.sendableEmailId && p.fitScore >= 50 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-indigo-100 pt-2 text-xs">
          <Hand className="h-3.5 w-3.5 text-slate-400" /><span className="text-slate-600">Warm touch (by hand, e.g. LinkedIn):</span>
          {(['TODO', 'TOUCHED', 'RESPONDED', 'SKIPPED'] as const).map((w) => (
            <button key={w} onClick={() => onPatch({ warmTouch: w }, 'Saved')} className={`rounded-full border px-2 py-0.5 ${p.warmTouch === w ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 text-slate-600'}`}>
              {w === 'TODO' ? 'to do' : w.toLowerCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
