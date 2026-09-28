import { Flame, ThermometerSun, Snowflake } from 'lucide-react'
import { cn } from '@/lib/utils'

export const BIZ_STATUS: Record<string, { label: string; className: string }> = {
  NEW: { label: 'Queued', className: 'bg-slate-100 text-slate-600' },
  RESEARCHING: { label: 'Researching', className: 'bg-sky-50 text-sky-700' },
  READY: { label: 'Ready to email', className: 'bg-emerald-50 text-emerald-700' },
  EMAIL_FOUND: { label: 'Email unconfirmed', className: 'bg-amber-50 text-amber-700' },
  NO_EMAIL: { label: 'No email · call', className: 'bg-orange-50 text-orange-700' },
  IN_CAMPAIGN: { label: 'In campaign', className: 'bg-indigo-50 text-indigo-700' },
  EXCLUDED: { label: 'Excluded', className: 'bg-slate-100 text-slate-400' },
  DO_NOT_CONTACT: { label: 'Do not contact', className: 'bg-red-50 text-red-600' },
}

export const SOURCE_LABEL: Record<string, string> = {
  LISTING: 'on their map listing', WEBSITE: 'on their website', SEARCH: 'published elsewhere (web search)', HUNTER: 'Hunter',
  PATTERN: 'owner-name guess, verified', ROLE_GUESS: 'inbox guess, verified', MANUAL: 'added by you',
}

export function BizStatusBadge({ status, className }: { status: string; className?: string }) {
  const s = BIZ_STATUS[status] || { label: status, className: 'bg-slate-100 text-slate-600' }
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', s.className, className)}>{s.label}</span>
}

export function TierBadge({ tier }: { tier: string }) {
  if (tier === 'HOT') return <span className="inline-flex items-center gap-0.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600"><Flame className="h-3 w-3" />Hot</span>
  if (tier === 'WARM') return <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"><ThermometerSun className="h-3 w-3" />Warm</span>
  return <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500"><Snowflake className="h-3 w-3" />Cold</span>
}

export function FitBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-400' : 'bg-slate-300'
  return (
    <div className="flex items-center gap-2">
      <span className="w-6 text-right text-sm font-semibold tabular-nums text-slate-800">{score}</span>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-100"><span className={cn('block h-full rounded-full', color)} style={{ width: `${score}%` }} /></span>
    </div>
  )
}
