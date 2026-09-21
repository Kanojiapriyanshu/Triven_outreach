import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

// GET /api/inbox/unread → { unread } for the sidebar badge
export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const unread = await prisma.emailMessage.count({ where: { direction: 'INBOUND', isRead: false } })
  return NextResponse.json({ unread })
}
