import { STATUS_LABELS, STATUS_COLORS } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { LeadStatus } from '@/types'

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const colors = STATUS_COLORS[status as LeadStatus] || 'bg-slate-100 text-slate-600'
  const label = STATUS_LABELS[status as LeadStatus] || status
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', colors, className)}>
      {label}
    </span>
  )
}

export function PriorityBadge({ priority, className }: { priority: string; className?: string }) {
  const colors: Record<string, string> = {
    LOW: 'text-slate-500',
    MEDIUM: 'text-blue-600',
    HIGH: 'text-orange-600',
    URGENT: 'text-red-600',
  }
  const arrows: Record<string, string> = { LOW: '↓', MEDIUM: '→', HIGH: '↑', URGENT: '⬆' }
  return (
    <span className={cn('text-xs font-medium', colors[priority] || 'text-slate-500', className)}>
      {arrows[priority] || ''} {priority}
    </span>
  )
}
