import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { startOfDay, endOfDay } from 'date-fns'

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const todayStart = startOfDay(new Date())
  const todayEnd = endOfDay(new Date())

  const tasks = await prisma.followUpTask.findMany({
    where: {
      status: 'PENDING',
      scheduledAt: { gte: todayStart, lte: todayEnd },
    },
    include: {
      lead: {
        select: {
          id: true,
          companyName: true,
          fullName: true,
          firstName: true,
          lastName: true,
          companyEmail: true,
          status: true,
          campaignId: true,
          campaign: { select: { id: true, name: true } },
          senderAccount: { select: { id: true, displayName: true, email: true } },
        },
      },
      senderAccount: { select: { id: true, displayName: true, email: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  })

  // Also get leads with READY_TO_CONTACT status (first emails due)
  const firstEmailLeads = await prisma.lead.findMany({
    where: {
      status: 'READY_TO_CONTACT',
    },
    include: {
      campaign: { select: { id: true, name: true } },
      senderAccount: { select: { id: true, displayName: true, email: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({ tasks, firstEmailLeads })
}
