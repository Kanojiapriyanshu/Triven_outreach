// One place to raise in-app notifications. Alerts about the same thing are grouped: while an
// alert with the same `group` is still unread, it is updated (count bumped) instead of stacking
// a new row, so a busy worker never floods the bell.
import prisma from './prisma'

export type NotificationType =
  | 'REPLY' | 'FOLLOW_UP_DUE' | 'FOLLOW_UP_OVERDUE' | 'MEETING' | 'DEMO' | 'IMPORT_DONE' | 'IMPORT_ERROR' | 'GMAIL_ERROR'
  | 'LEADS_READY' | 'SEARCH_DONE' | 'CREDITS_LOW' | 'QUOTA' | 'CAMPAIGN_EMPTY' | 'BOUNCE' | 'SYSTEM'

export interface NotifyInput {
  type: NotificationType
  title: string
  body?: string
  /** Where clicking goes (defaults to the lead, if any) */
  href?: string
  leadId?: string
  /** Same group + still unread → update that alert instead of adding one */
  group?: string
  /** For grouped alerts: add this to the running count shown in the title via {n} */
  count?: number
  /** Don't raise the same group again within this many hours, even after it was read */
  cooldownHours?: number
}

export async function notify(n: NotifyInput) {
  try {
    if (n.group) {
      const existing = await prisma.notification.findFirst({
        where: { type: n.type, metadata: { path: ['group'], equals: n.group } },
        orderBy: { createdAt: 'desc' },
      })
      if (existing && !existing.isRead) {
        const meta = (existing.metadata || {}) as { count?: number }
        const count = (meta.count || 0) + (n.count || 0)
        await prisma.notification.update({
          where: { id: existing.id },
          data: { title: n.title.replace('{n}', String(count)), body: n.body, metadata: { ...meta, group: n.group, href: n.href, count }, createdAt: new Date() },
        })
        return
      }
      if (existing && n.cooldownHours && Date.now() - existing.createdAt.getTime() < n.cooldownHours * 3_600_000) return
    }
    await prisma.notification.create({
      data: {
        type: n.type,
        title: n.title.replace('{n}', String(n.count || 0)),
        body: n.body,
        leadId: n.leadId,
        metadata: { group: n.group, href: n.href, count: n.count || 0 },
      },
    })
  } catch (err) {
    // A notification must never break the work that raised it
    console.error('notify failed', err)
  }
}
