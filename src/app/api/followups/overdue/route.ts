import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { startOfDay } from 'date-fns'

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const todayStart = startOfDay(new Date())

  const tasks = await prisma.followUpTask.findMany({
    where: {
      status: 'PENDING',
      type: { startsWith: 'FOLLOW_UP' },
      scheduledAt: { lt: todayStart },
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
          campaign: { select: { id: true, name: true } },
          senderAccount: { select: { id: true, displayName: true, email: true } },
        },
      },
      senderAccount: { select: { id: true, displayName: true, email: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  })

  return NextResponse.json(tasks)
}
