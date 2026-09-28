/** GET /api/nav → sidebar badges: unread replies, businesses and prospects ready to add */
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [unread, finderReady, prospectsReady] = await Promise.all([
    prisma.emailMessage.count({ where: { direction: 'INBOUND', isRead: false } }),
    prisma.business.count({ where: { status: 'READY' } }),
    prisma.prospect.count({ where: { status: 'READY_TO_CONTACT' } }),
  ])
  return NextResponse.json({ unread, finderReady, prospectsReady })
}
