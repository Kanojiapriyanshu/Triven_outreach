import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

/** GET /api/notifications?unread=1 → latest alerts (with where each one links to) */
export async function GET(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const onlyUnread = new URL(req.url).searchParams.get('unread') === '1'
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({ where: onlyUnread ? { isRead: false } : {}, orderBy: { createdAt: 'desc' }, take: 40 }),
    prisma.notification.count({ where: { isRead: false } }),
  ])
  const items = rows.map((n) => {
    const meta = (n.metadata || {}) as { href?: string }
    return { ...n, href: meta.href || (n.leadId ? `/leads/${n.leadId}` : n.type === 'GMAIL_ERROR' ? '/sender-accounts' : null) }
  })
  return NextResponse.json({ items, unread })
}

/** POST { id? } → mark one (or everything) as read */
export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json().catch(() => ({})) as { id?: string }
  if (id) await prisma.notification.update({ where: { id }, data: { isRead: true } }).catch(() => null)
  else await prisma.notification.updateMany({ where: { isRead: false }, data: { isRead: true } })
  return NextResponse.json({ ok: true })
}

/** DELETE → clear everything already read */
export async function DELETE() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const r = await prisma.notification.deleteMany({ where: { isRead: true } })
  return NextResponse.json({ deleted: r.count })
}
