import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { addDays } from 'date-fns'
import { skipWeekend } from '@/lib/template'
import { refreshNextFollowUp } from '@/lib/followups'

const bulkSchema = z.object({
  leadIds: z.array(z.string()).min(1),
  action: z.enum(['assign_campaign', 'assign_sender', 'change_status', 'set_priority', 'pause_sequence', 'resume_sequence', 'archive']),
  value: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = bulkSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid bulk action' }, { status: 400 })
  const { leadIds, action, value } = parsed.data

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
      await prisma.lead.updateMany({ where: { id: { in: leadIds } }, data: { nextFollowUpAt: null } })
      break
    case 'resume_sequence': {
      // Re-schedule stopped follow-ups from tomorrow, keeping the original gaps between them
      const tasks = await prisma.followUpTask.findMany({
        where: { leadId: { in: leadIds }, status: 'CANCELLED' },
        orderBy: { scheduledAt: 'asc' },
      })
      const firstByLead = new Map<string, number>()
      const start = addDays(new Date(), 1).getTime()
      for (const t of tasks) {
        if (!firstByLead.has(t.leadId)) firstByLead.set(t.leadId, t.scheduledAt.getTime())
        const offset = t.scheduledAt.getTime() - firstByLead.get(t.leadId)!
        await prisma.followUpTask.update({
          where: { id: t.id },
          data: { status: 'PENDING', scheduledAt: skipWeekend(new Date(start + offset)) },
        })
      }
      for (const leadId of firstByLead.keys()) await refreshNextFollowUp(leadId)
      break
    }
  }

  return NextResponse.json({ updated: leadIds.length })
}
