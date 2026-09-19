import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, parseISO, isValid } from 'date-fns'
import type { LeadStatus, LeadPriority } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Date helpers ────────────────────────────────────────────────────────────

export function fmtDate(d: string | Date | null | undefined, fmt = 'MMM d, yyyy') {
  if (!d) return '—'
  const date = typeof d === 'string' ? parseISO(d) : d
  if (!isValid(date)) return '—'
  return format(date, fmt)
}

export function fmtRelative(d: string | Date | null | undefined) {
  if (!d) return '—'
  const date = typeof d === 'string' ? parseISO(d) : d
  if (!isValid(date)) return '—'
  return formatDistanceToNow(date, { addSuffix: true })
}

export function fmtDateTime(d: string | Date | null | undefined) {
  return fmtDate(d, 'MMM d, yyyy h:mm a')
}

export function isToday(d: string | Date | null | undefined) {
  if (!d) return false
  const date = typeof d === 'string' ? parseISO(d) : d
  if (!isValid(date)) return false
  const today = new Date()
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  )
}

export function isOverdue(d: string | Date | null | undefined) {
  if (!d) return false
  const date = typeof d === 'string' ? parseISO(d) : d
  if (!isValid(date)) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date < today
}

// ─── Status helpers ──────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: 'New',
  RESEARCHING: 'Researching',
  READY_TO_CONTACT: 'Ready to Contact',
  FIRST_EMAIL_SENT: 'Email Sent',
  FOLLOW_UP_1_DUE: 'Follow-up 1 Due',
  FOLLOW_UP_1_SENT: 'Follow-up 1 Sent',
  FOLLOW_UP_2_DUE: 'Follow-up 2 Due',
  FOLLOW_UP_2_SENT: 'Follow-up 2 Sent',
  FOLLOW_UP_3_DUE: 'Follow-up 3 Due',
  FOLLOW_UP_3_SENT: 'Follow-up 3 Sent',
  REPLIED: 'Replied',
  INTERESTED: 'Interested',
  DEMO_SENT: 'Demo Sent',
  MEETING_BOOKED: 'Meeting Booked',
  PROPOSAL_SENT: 'Proposal Sent',
  WON: 'Won',
  LOST: 'Lost',
  NOT_INTERESTED: 'Not Interested',
  UNSUBSCRIBED: 'Unsubscribed',
  INVALID_EMAIL: 'Invalid Email',
  DO_NOT_CONTACT: 'Do Not Contact',
}

export const STATUS_COLORS: Record<LeadStatus, string> = {
  NEW: 'bg-slate-100 text-slate-700',
  RESEARCHING: 'bg-purple-100 text-purple-700',
  READY_TO_CONTACT: 'bg-blue-100 text-blue-700',
  FIRST_EMAIL_SENT: 'bg-indigo-100 text-indigo-700',
  FOLLOW_UP_1_DUE: 'bg-yellow-100 text-yellow-700',
  FOLLOW_UP_1_SENT: 'bg-yellow-100 text-yellow-800',
  FOLLOW_UP_2_DUE: 'bg-orange-100 text-orange-700',
  FOLLOW_UP_2_SENT: 'bg-orange-100 text-orange-800',
  FOLLOW_UP_3_DUE: 'bg-red-100 text-red-700',
  FOLLOW_UP_3_SENT: 'bg-red-100 text-red-800',
  REPLIED: 'bg-teal-100 text-teal-700',
  INTERESTED: 'bg-green-100 text-green-700',
  DEMO_SENT: 'bg-cyan-100 text-cyan-700',
  MEETING_BOOKED: 'bg-emerald-100 text-emerald-700',
  PROPOSAL_SENT: 'bg-lime-100 text-lime-700',
  WON: 'bg-green-200 text-green-800',
  LOST: 'bg-red-200 text-red-800',
  NOT_INTERESTED: 'bg-slate-200 text-slate-600',
  UNSUBSCRIBED: 'bg-gray-200 text-gray-600',
  INVALID_EMAIL: 'bg-red-50 text-red-500',
  DO_NOT_CONTACT: 'bg-black text-white',
}

export const PRIORITY_COLORS: Record<LeadPriority, string> = {
  LOW: 'bg-slate-100 text-slate-600',
  MEDIUM: 'bg-blue-100 text-blue-700',
  HIGH: 'bg-orange-100 text-orange-700',
  URGENT: 'bg-red-100 text-red-700',
}

// Statuses where follow-ups should be stopped
export const STOP_FOLLOWUP_STATUSES: LeadStatus[] = [
  'REPLIED',
  'INTERESTED',
  'DEMO_SENT',
  'MEETING_BOOKED',
  'PROPOSAL_SENT',
  'WON',
  'LOST',
  'NOT_INTERESTED',
  'UNSUBSCRIBED',
  'DO_NOT_CONTACT',
]

// ─── Misc helpers ────────────────────────────────────────────────────────────

export function slugify(str: string) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export function truncate(str: string, length = 80) {
  return str.length > length ? str.slice(0, length) + '…' : str
}

export function fmtCurrency(value: number | string | null | undefined) {
  if (value == null) return '—'
  const n = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(n)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export function getDisplayName(lead: { firstName?: string | null; lastName?: string | null; fullName?: string | null; companyName: string }) {
  if (lead.fullName) return lead.fullName
  if (lead.firstName || lead.lastName) return [lead.firstName, lead.lastName].filter(Boolean).join(' ')
  return lead.companyName
}
