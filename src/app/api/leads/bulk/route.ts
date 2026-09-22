import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { addDays } from 'date-fns'
import { nextWindowSlot } from '@/lib/send-window'
import { getSettings } from '@/lib/settings'
import { refreshNextFollowUp } from '@/lib/followups'

const bulkSchema = z.object({
  leadIds: z.array(z.string()).min(1),
  action: z.enum(['assign_campaign', 'assign_sender', 'change_status', 'set_priority', 'pause_sequence', 'resume_sequence', 'archive', 'delete']),
  value: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = bulkSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid bulk action' }, { status: 400 })
  const { leadIds, action, value } = parsed.data

  switch (action) {
    case 'delete': {
      // Emails, activity and follow-ups are removed with the lead (cascade);
      // notifications only hold a plain leadId, so clear those too
      let deleted = 0
      for (let i = 0; i < leadIds.length; i += 500) {
        const chunk = leadIds.slice(i, i + 500)
        await prisma.notification.deleteMany({ where: { leadId: { in: chunk } } })
        deleted += (await prisma.lead.deleteMany({ where: { id: { in: chunk } } })).count
      }
      return NextResponse.json({ deleted })
    }
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
      const { sendWindow } = await getSettings()
      const firstByLead = new Map<string, number>()
      const start = addDays(new Date(), 1).getTime()
      for (const t of tasks) {
        if (!firstByLead.has(t.leadId)) firstByLead.set(t.leadId, t.scheduledAt.getTime())
        const offset = t.scheduledAt.getTime() - firstByLead.get(t.leadId)!
        await prisma.followUpTask.update({
          where: { id: t.id },
          data: { status: 'PENDING', scheduledAt: nextWindowSlot(new Date(start + offset), sendWindow) },
        })
      }
      for (const leadId of firstByLead.keys()) await refreshNextFollowUp(leadId)
      break
    }
  }

  return NextResponse.json({ updated: leadIds.length })
}
