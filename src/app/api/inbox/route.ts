import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

/**
 * GET /api/inbox?inbox=<senderAccountId|all>&view=replies|all|sent|unread&q=
 * One row per lead conversation, newest activity first (Instantly "Unibox" style).
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const inbox = sp.get('inbox') || 'all'
  const view = sp.get('view') || 'replies'
  const q = sp.get('q')?.trim()

  const where: Prisma.LeadWhereInput = {
    emailMessages: { some: {} },
    ...(inbox !== 'all' ? { senderAccountId: inbox } : {}),
    ...(view === 'replies' ? { hasReplied: true } : {}),
    ...(view === 'sent' ? { hasReplied: false } : {}),
    ...(view === 'unread' ? { emailMessages: { some: { direction: 'INBOUND', isRead: false } } } : {}),
    ...(q ? {
      OR: [
        { companyName: { contains: q, mode: 'insensitive' } },
        { fullName: { contains: q, mode: 'insensitive' } },
        { companyEmail: { contains: q, mode: 'insensitive' } },
      ],
    } : {}),
  }

  const leads = await prisma.lead.findMany({
    where,
    select: {
      id: true, companyName: true, fullName: true, firstName: true, companyEmail: true, status: true,
      hasReplied: true, lastContactedAt: true, lastResponseAt: true,
      senderAccount: { select: { id: true, displayName: true, email: true } },
      campaign: { select: { name: true } },
      emailMessages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { direction: true, subject: true, body: true, createdAt: true },
      },
      _count: { select: { emailMessages: { where: { direction: 'INBOUND', isRead: false } } } },
    },
    take: 200,
  })

  const rows = leads
    .map((l) => ({
      ...l,
      last: l.emailMessages[0] ?? null,
      unread: l._count.emailMessages,
      lastAt: (l.emailMessages[0]?.createdAt ?? l.lastContactedAt ?? new Date(0)).toString(),
    }))
    .sort((a, b) => new Date(b.last?.createdAt ?? 0).getTime() - new Date(a.last?.createdAt ?? 0).getTime())
    .map(({ emailMessages: _m, _count: _c, ...rest }) => rest)

  // Per-inbox counters for the sidebar
  const senders = await prisma.senderAccount.findMany({
    select: { id: true, displayName: true, email: true, gmailStatus: true },
    orderBy: { displayName: 'asc' },
  })
  const counts = await Promise.all(senders.map(async (s) => ({
    ...s,
    unread: await prisma.emailMessage.count({ where: { direction: 'INBOUND', isRead: false, lead: { senderAccountId: s.id } } }),
    replies: await prisma.lead.count({ where: { senderAccountId: s.id, hasReplied: true } }),
  })))

  return NextResponse.json({ conversations: rows, inboxes: counts })
}
