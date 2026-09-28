/** GET /api/pipeline → leads past first reply, grouped by deal stage, with values and where they came from */
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

const STAGES = ['REPLIED', 'INTERESTED', 'MEETING_BOOKED', 'PROPOSAL_SENT', 'WON', 'LOST'] as const

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leads = await prisma.lead.findMany({
    where: { status: { in: [...STAGES] } },
    orderBy: [{ lastResponseAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
    take: 600,
    select: {
      id: true, fullName: true, companyName: true, companyEmail: true, status: true, dealValue: true, meetingDate: true, saleDate: true,
      lastResponseAt: true, replyCategory: true, leadSource: true, sourcePlatform: true, sourceChannel: true, useCase: true, industry: true,
      campaign: { select: { name: true } },
    },
  })
  const columns = STAGES.map((stage) => {
    const items = leads.filter((l) => l.status === stage)
    return { stage, count: items.length, value: items.reduce((n, l) => n + Number(l.dealValue || 0), 0), items: items.slice(0, 100) }
  })
  return NextResponse.json({ columns })
}
