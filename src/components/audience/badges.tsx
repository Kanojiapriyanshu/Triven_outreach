import { cn } from '@/lib/utils'
import { PROSPECT_STATUSES, outreachStatus, type ProspectStatus } from '@/lib/audience/taxonomy'

const REL = {
  HIGH: 'bg-emerald-100 text-emerald-800',
  MEDIUM: 'bg-sky-100 text-sky-800',
  LOW: 'bg-slate-100 text-slate-500',
  SPAM: 'bg-red-50 text-red-500',
} as Record<string, string>

export function RelevanceBadge({ value, score, className }: { value: string; score?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', REL[value] || REL.LOW, className)}>
      {value === 'MEDIUM' ? 'Medium' : value.charAt(0) + value.slice(1).toLowerCase()}
      {score !== undefined && <span className="font-normal opacity-70">{score}</span>}
    </span>
  )
}

const EMAIL = {
  VERIFIED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  RISKY: 'bg-amber-50 text-amber-700 border-amber-200',
  UNKNOWN: 'bg-slate-50 text-slate-600 border-slate-200',
  INVALID: 'bg-red-50 text-red-600 border-red-200 line-through',
} as Record<string, string>

export function EmailChip({ email, status, primary }: { email: string; status: string; primary?: boolean }) {
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]', EMAIL[status] || EMAIL.UNKNOWN)} title={`${status.toLowerCase()}${primary ? ' · primary' : ''}`}>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', status === 'VERIFIED' ? 'bg-emerald-500' : status === 'RISKY' ? 'bg-amber-500' : status === 'INVALID' ? 'bg-red-500' : 'bg-slate-400')} />
      <span className="truncate">{email}</span>
    </span>
  )
}

const STATUS = {
  NEW: 'bg-slate-100 text-slate-600',
  RESEARCHING: 'bg-purple-100 text-purple-700',
  PROFILE_FOUND: 'bg-violet-100 text-violet-700',
  EMAIL_FOUND: 'bg-blue-100 text-blue-700',
  EMAIL_VERIFIED: 'bg-cyan-100 text-cyan-800',
  READY_TO_CONTACT: 'bg-emerald-100 text-emerald-800',
  NO_CONTACT: 'bg-slate-100 text-slate-400',
  IN_CAMPAIGN: 'bg-indigo-100 text-indigo-700',
  INVALID_EMAIL: 'bg-red-50 text-red-600',
  DO_NOT_CONTACT: 'bg-slate-900 text-white',
} as Record<string, string>

export function ProspectStatusBadge({ status, leadStatus }: { status: string; leadStatus?: string | null }) {
  const outreach = status === 'IN_CAMPAIGN' ? outreachStatus(leadStatus) : null
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', STATUS[status] || STATUS.NEW)}>
      {outreach || PROSPECT_STATUSES[status as ProspectStatus] || status}
    </span>
  )
}

export function fmtNum(n?: number | null) {
  if (n === null || n === undefined) return '–'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function Avatar({ src, name, size = 32 }: { src?: string | null; name: string; size?: number }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" className="shrink-0 rounded-full bg-slate-100 object-cover" style={{ width: size, height: size }} />
  }
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700" style={{ width: size, height: size }}>
      {name.replace(/^@/, '').charAt(0).toUpperCase() || '?'}
    </span>
  )
}
