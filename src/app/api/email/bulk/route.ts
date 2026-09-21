import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { nextWindowSlot } from '@/lib/send-window'
import { pickDefaultTemplate } from '@/lib/template'
import { dailyAllowance } from '@/lib/outreach'
import { refreshNextFollowUp } from '@/lib/followups'
import { STOP_FOLLOWUP_STATUSES } from '@/lib/utils'

const bulkSchema = z.object({
  leadIds: z.array(z.string()).min(1, 'Select at least one lead').max(5000),
  // A specific first-email template, or omit to use each lead's niche default
  templateId: z.string().optional(),
  // Inboxes to rotate across (default: every connected inbox)
  senderAccountIds: z.array(z.string()).optional(),
  // 'now' = start right away, 'window' = start in the next send window, ISO = start then
  start: z.union([z.enum(['now', 'window']), z.string().datetime({ offset: true })]).default('window'),
})

/**
 * POST /api/email/bulk: queue a first email for many leads. Each email is rendered with
 * that lead's own data when it is sent; the sequencer spaces them out per inbox.
 */
export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = bulkSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  const input = parsed.data
  const settings = await getSettings()

  const senders = await prisma.senderAccount.findMany({
    where: { gmailStatus: 'CONNECTED', isActive: true, ...(input.senderAccountIds?.length ? { id: { in: input.senderAccountIds } } : {}) },
  })
  if (!senders.length) return NextResponse.json({ error: 'No connected inbox selected' }, { status: 400 })

  const templates = await prisma.emailTemplate.findMany({ where: { type: 'FIRST_EMAIL' } })
  const chosen = input.templateId ? templates.find((t) => t.id === input.templateId) : undefined
  if (input.templateId && !chosen) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  const startAt = input.start === 'now' ? new Date()
    : input.start === 'window' ? nextWindowSlot(new Date(), settings.sendWindow, 0)
    : new Date(input.start)

  const leads = await prisma.lead.findMany({
    where: { id: { in: input.leadIds } },
    include: { followUpTasks: { where: { status: 'PENDING', type: 'FIRST_EMAIL' }, select: { id: true } } },
  })
  const suppressed = await prisma.suppressionEntry.findMany({ select: { email: true, domain: true } })
  const blockedEmails = new Set(suppressed.map((s) => s.email).filter(Boolean))
  const blockedDomains = new Set(suppressed.map((s) => s.domain).filter(Boolean))

  // Spread leads across inboxes, fullest allowance first
  const allowances = await Promise.all(senders.map(async (s) => ({ s, a: await dailyAllowance(s, settings.dailyCapPerSender) })))
  allowances.sort((x, y) => y.a.left - x.a.left)
  const rotation = allowances.map((x) => x.s)

  const skipped: Record<string, number> = {}
  const skip = (why: string) => { skipped[why] = (skipped[why] || 0) + 1 }
  let queued = 0
  let turn = 0

  for (const lead of leads) {
    const email = lead.companyEmail?.toLowerCase()
    if (!email) { skip('No email address'); continue }
    if (lead.firstEmailSentAt) { skip('Already contacted'); continue }
    if (lead.followUpTasks.length) { skip('Already queued'); continue }
    if (lead.hasReplied || STOP_FOLLOWUP_STATUSES.includes(lead.status as never)) { skip('Replied or opted out'); continue }
    if (blockedEmails.has(email) || blockedDomains.has(email.split('@')[1])) { skip('On do-not-contact list'); continue }

    const template = chosen ?? pickDefaultTemplate(templates, 'FIRST_EMAIL', lead.campaignId)
    if (!template) { skip('No first-email template for its niche'); continue }

    // Keep an existing inbox assignment if it's in the rotation, otherwise take the next inbox
    const sender = rotation.find((s) => s.id === lead.senderAccountId) ?? rotation[turn++ % rotation.length]
    await prisma.followUpTask.create({
      data: {
        leadId: lead.id,
        senderAccountId: sender.id,
        type: 'FIRST_EMAIL',
        scheduledAt: startAt,
        // Raw template: variables are filled in per lead at the moment it sends
        subject: template.subject,
        body: template.body,
      },
    })
    await prisma.lead.update({ where: { id: lead.id }, data: { senderAccountId: sender.id } })
    await refreshNextFollowUp(lead.id)
    queued++
  }

  const perDay = allowances.reduce((n, x) => n + x.a.limit, 0)
  return NextResponse.json({
    queued,
    skipped,
    startAt: startAt.toISOString(),
    inboxes: rotation.length,
    perDay,
    estimatedDays: perDay ? Math.ceil(queued / perDay) : null,
  })
}
