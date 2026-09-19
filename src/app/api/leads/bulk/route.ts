import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

const bulkSchema = z.object({
  leadIds: z.array(z.string()).min(1),
  action: z.enum(['assign_campaign', 'assign_sender', 'change_status', 'set_priority', 'pause_sequence', 'resume_sequence', 'archive']),
  value: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = bulkSchema.parse(await req.json())
  const { leadIds, action, value } = body

  switch (action) {
    case 'assign_campaign':
      await prisma.lead.updateMany({ where: { id: { in: leadIds } }, data: { campaignId: value || null } })
      break
    case 'assign_sender':
      await prisma.lead.updateMany({ where: { id: { in: leadIds } }, data: { senderAccountId: value || null } })
      break
    case 'change_status':
      if (value) await prisma.lead.updateMany({ where: { id: { in: leadIds } }, data: { status: value } })
      break
    case 'set_priority':
      if (value) await prisma.lead.updateMany({ where: { id: { in: leadIds } }, data: { priority: value } })
      break
    case 'pause_sequence':
      await prisma.followUpTask.updateMany({
        where: { leadId: { in: leadIds }, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      })
      break
    case 'resume_sequence':
      // Re-schedule CANCELLED tasks from today
      await prisma.followUpTask.updateMany({
        where: { leadId: { in: leadIds }, status: 'CANCELLED' },
        data: { status: 'PENDING', scheduledAt: new Date() },
      })
      break
  }

  return NextResponse.json({ updated: leadIds.length })
}
