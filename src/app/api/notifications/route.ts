import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.notification.count({ where: { isRead: false } }),
  ])
  return NextResponse.json({ items, unread })
}

// Mark everything as read
export async function POST() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await prisma.notification.updateMany({ where: { isRead: false }, data: { isRead: true } })
  return NextResponse.json({ ok: true })
}
