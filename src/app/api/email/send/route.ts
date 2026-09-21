import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { guessCompanyFromEmail } from '@/lib/template'
import { refreshNextFollowUp } from '@/lib/followups'
import { deliverEmail, assertSendable, scheduleFollowUps, OutreachError, type FollowUpPlanStep } from '@/lib/outreach'
import { getSettings } from '@/lib/settings'
import { nextWindowSlot } from '@/lib/send-window'

const sendSchema = z.object({
  // Either an existing lead…
  leadId: z.string().optional(),
  // …or a new one created on the fly ("New Email")
  newLead: z.object({
    email: z.string().email('Enter a valid email address'),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    companyName: z.string().optional(),
    campaignId: z.string().optional(),
  }).optional(),
  senderAccountId: z.string().min(1, 'Select a sender account'),
  subject: z.string().trim().min(1, 'Subject is required'),
  body: z.string().trim().min(1, 'Email body is required'),
  type: z.enum(['FIRST_EMAIL', 'OTHER']).optional(),
  // Follow-up plan (first email only). Bodies are raw templates rendered at send time.
  followUps: z.array(z.object({
    step: z.number().int().min(1).max(3),
    delayDays: z.number().int().min(1).max(60),
    body: z.string().optional(),
  })).max(3).optional(),
  // Omit = send now. "window" = next send window. ISO string = that exact time.
  scheduleAt: z.union([z.literal('window'), z.string().datetime({ offset: true })]).optional(),
})

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = sendSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || 'Invalid request' }, { status: 400 })
  }
  const input = parsed.data

  try {
    const settings = await getSettings()

    // ── Resolve the lead ───────────────────────────────────────────────────────
    let lead = input.leadId ? await prisma.lead.findUnique({ where: { id: input.leadId } }) : null

    if (!lead && input.newLead) {
      const email = input.newLead.email.trim().toLowerCase()
      lead = await prisma.lead.findFirst({ where: { companyEmail: email } })
      if (!lead) {
        const { firstName, lastName, campaignId } = input.newLead
        lead = await prisma.lead.create({
          data: {
            companyEmail: email,
            firstName: firstName || undefined,
            lastName: lastName || undefined,
            fullName: [firstName, lastName].filter(Boolean).join(' ') || undefined,
            companyName: input.newLead.companyName?.trim() || guessCompanyFromEmail(email) || email.split('@')[1],
            campaignId: campaignId || undefined,
            senderAccountId: input.senderAccountId,
            leadSource: 'MANUAL',
            assignedUserId: session.userId,
          },
        })
        await prisma.activity.create({
          data: { leadId: lead.id, userId: session.userId, type: 'NOTE_ADDED', title: 'Lead created', body: `Created from New Email by ${session.name}` },
        })
      }
    }
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const sender = await assertSendable(lead, await prisma.senderAccount.findUnique({ where: { id: input.senderAccountId } }))
    const kind = input.type ?? (lead.firstEmailSentAt ? 'OTHER' : 'FIRST_EMAIL')

    // No plan from the client → campaign schedule, else the global default (bodies = default templates)
    const campaign = lead.campaignId ? await prisma.campaign.findUnique({ where: { id: lead.campaignId } }) : null
    const campaignDays = campaign ? [campaign.followUpDay1, campaign.followUpDay2, campaign.followUpDay3] : null
    const plan: FollowUpPlanStep[] = input.followUps ?? [1, 2, 3].map(step => ({
      step,
      delayDays: campaignDays?.[step - 1] ?? settings.followUpDays[step - 1],
    }))

    // ── Schedule for later ─────────────────────────────────────────────────────
    if (input.scheduleAt) {
      const sendAt = input.scheduleAt === 'window'
        ? nextWindowSlot(new Date(), settings.sendWindow)
        : new Date(input.scheduleAt)
      if (sendAt.getTime() < Date.now() - 60_000) {
        return NextResponse.json({ error: 'Pick a time in the future' }, { status: 400 })
      }

      if (kind === 'FIRST_EMAIL') {
        // Replace any earlier scheduled first email
        await prisma.followUpTask.updateMany({
          where: { leadId: lead.id, type: 'FIRST_EMAIL', status: 'PENDING' },
          data: { status: 'CANCELLED' },
        })
      }
      await prisma.followUpTask.create({
        data: {
          leadId: lead.id,
          senderAccountId: sender.id,
          type: kind,
          scheduledAt: sendAt,
          subject: input.subject,
          body: input.body,
        },
      })
      const scheduled = kind === 'FIRST_EMAIL'
        ? await scheduleFollowUps({ leadId: lead.id, senderAccountId: sender.id, base: sendAt, plan, window: settings.sendWindow })
        : 0
      await prisma.lead.update({ where: { id: lead.id }, data: { senderAccountId: lead.senderAccountId || sender.id } })
      await refreshNextFollowUp(lead.id)
      await prisma.activity.create({
        data: {
          leadId: lead.id,
          userId: session.userId,
          senderAccountId: sender.id,
          type: 'TASK_CREATED',
          title: `${kind === 'FIRST_EMAIL' ? 'First email' : 'Email'} scheduled`,
          body: `${sendAt.toISOString()}${scheduled ? ` · ${scheduled} follow-ups planned` : ''}`,
        },
      })
      return NextResponse.json({ ok: true, leadId: lead.id, scheduledAt: sendAt.toISOString(), followUpsScheduled: scheduled })
    }

    // ── Send now ───────────────────────────────────────────────────────────────
    const sent = await deliverEmail({ lead, sender, subject: input.subject, body: input.body, kind, userId: session.userId })

    let scheduled = 0
    if (kind === 'FIRST_EMAIL') {
      // A scheduled first email for this lead is now redundant
      await prisma.followUpTask.updateMany({
        where: { leadId: lead.id, type: 'FIRST_EMAIL', status: 'PENDING' },
        data: { status: 'CANCELLED' },
      })
      scheduled = await scheduleFollowUps({ leadId: lead.id, senderAccountId: sender.id, base: new Date(), plan, window: settings.sendWindow })
      await refreshNextFollowUp(lead.id)
    }

    return NextResponse.json({ ok: true, leadId: lead.id, gmailMessageId: sent.gmailMessageId, followUpsScheduled: scheduled })
  } catch (err: unknown) {
    if (err instanceof OutreachError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[email/send]', err)
    const msg = err instanceof Error ? err.message : 'Failed to send email'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
