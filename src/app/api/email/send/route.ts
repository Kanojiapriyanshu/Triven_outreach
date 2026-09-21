import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { sendGmail } from '@/lib/gmail'
import prisma from '@/lib/prisma'
import { addDays } from 'date-fns'
import { buildTemplateVars, renderTemplate, guessCompanyFromEmail, skipWeekend, FOLLOW_UP_TYPES } from '@/lib/template'
import { refreshNextFollowUp } from '@/lib/followups'

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
  // Follow-up plan (only used for the first email). Bodies are raw templates rendered at send time.
  followUps: z.array(z.object({
    step: z.number().int().min(1).max(3),
    delayDays: z.number().int().min(1).max(60),
    body: z.string().optional(),
  })).max(3).optional(),
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
    // ── Resolve the lead ───────────────────────────────────────────────────────
    let lead = input.leadId
      ? await prisma.lead.findUnique({ where: { id: input.leadId } })
      : null

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
    if (!lead.companyEmail) return NextResponse.json({ error: 'This lead has no email address' }, { status: 400 })

    const suppressed = await prisma.suppressionEntry.findFirst({ where: { email: lead.companyEmail.toLowerCase() } })
    if (suppressed) return NextResponse.json({ error: 'This email is on the do-not-contact list' }, { status: 400 })

    const sender = await prisma.senderAccount.findUnique({ where: { id: input.senderAccountId } })
    if (!sender) return NextResponse.json({ error: 'Sender account not found' }, { status: 400 })
    if (sender.gmailStatus !== 'CONNECTED') {
      return NextResponse.json({ error: `${sender.email} is not connected to Gmail — reconnect it in Sender Accounts` }, { status: 400 })
    }

    const type = input.type ?? (lead.firstEmailSentAt ? 'OTHER' : 'FIRST_EMAIL')
    const vars = buildTemplateVars(lead, sender)
    const subject = renderTemplate(input.subject, vars)
    const body = renderTemplate(input.body, vars)

    // ── Send ───────────────────────────────────────────────────────────────────
    const gmailMessage = await sendGmail({
      senderAccountId: sender.id,
      to: lead.companyEmail,
      subject,
      body,
    })
    const now = new Date()

    await prisma.emailMessage.create({
      data: {
        leadId: lead.id,
        direction: 'OUTBOUND',
        subject,
        body,
        fromAddress: sender.email,
        toAddress: lead.companyEmail,
        sentAt: now,
        gmailMessageId: gmailMessage.id || undefined,
        gmailThreadId: gmailMessage.threadId || undefined,
      },
    })

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        lastContactedAt: now,
        senderAccountId: lead.senderAccountId || sender.id,
        ...(type === 'FIRST_EMAIL'
          ? { status: 'FIRST_EMAIL_SENT', firstEmailSubject: subject, firstEmailBody: body, firstEmailSentAt: now }
          : {}),
      },
    })

    // ── Schedule follow-ups (first email only) ─────────────────────────────────
    let scheduled = 0
    if (type === 'FIRST_EMAIL') {
      // Replace any plan left over from an earlier first email
      await prisma.followUpTask.updateMany({
        where: { leadId: lead.id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      })

      let plan = input.followUps
      if (!plan) {
        // No plan sent → use the campaign schedule; bodies come from templates at send time
        const campaign = lead.campaignId ? await prisma.campaign.findUnique({ where: { id: lead.campaignId } }) : null
        plan = [
          { step: 1, delayDays: campaign?.followUpDay1 ?? 3 },
          { step: 2, delayDays: campaign?.followUpDay2 ?? 7 },
          { step: 3, delayDays: campaign?.followUpDay3 ?? 14 },
        ]
      }

      if (plan.length) {
        await prisma.followUpTask.createMany({
          data: plan.map(f => ({
            leadId: lead.id,
            senderAccountId: sender.id,
            type: FOLLOW_UP_TYPES[f.step - 1],
            scheduledAt: skipWeekend(addDays(now, f.delayDays)),
            body: f.body?.trim() || null,
          })),
        })
        scheduled = plan.length
      }
      await refreshNextFollowUp(lead.id)
    }

    await prisma.activity.create({
      data: {
        leadId: lead.id,
        userId: session.userId,
        senderAccountId: sender.id,
        type: 'EMAIL_SENT',
        title: type === 'FIRST_EMAIL' ? `First email sent: ${subject}` : `Email sent: ${subject}`,
        body: scheduled ? `${scheduled} follow-up${scheduled > 1 ? 's' : ''} scheduled` : undefined,
        metadata: { gmailMessageId: gmailMessage.id },
      },
    })

    return NextResponse.json({ ok: true, leadId: lead.id, gmailMessageId: gmailMessage.id, followUpsScheduled: scheduled })
  } catch (err: unknown) {
    console.error('[email/send]', err)
    const msg = err instanceof Error ? err.message : 'Failed to send email'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
