import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { sendGmail } from '@/lib/gmail'
import prisma from '@/lib/prisma'
import { addDays } from 'date-fns'

const sendSchema = z.object({
  leadId: z.string(),
  senderAccountId: z.string(),
  subject: z.string().min(1),
  body: z.string().min(1),
  type: z.enum(['FIRST_EMAIL', 'FOLLOW_UP_1', 'FOLLOW_UP_2', 'FOLLOW_UP_3', 'REPLY', 'OTHER']),
})

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = sendSchema.parse(await req.json())

    const lead = await prisma.lead.findUnique({ where: { id: body.leadId } })
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (!lead.companyEmail) return NextResponse.json({ error: 'Lead has no email' }, { status: 400 })

    // Check suppression list
    const suppressed = await prisma.suppressionEntry.findFirst({
      where: { email: lead.companyEmail.toLowerCase() },
    })
    if (suppressed) {
      return NextResponse.json({ error: 'Email is on suppression list' }, { status: 400 })
    }

    const gmailMessage = await sendGmail({
      senderAccountId: body.senderAccountId,
      to: lead.companyEmail,
      subject: body.subject,
      body: body.body,
    })

    const now = new Date()

    // Get campaign follow-up config
    const campaign = lead.campaignId
      ? await prisma.campaign.findUnique({ where: { id: lead.campaignId } })
      : null

    const day1 = campaign?.followUpDay1 ?? 1
    const day2 = campaign?.followUpDay2 ?? 2
    const day3 = campaign?.followUpDay3 ?? 3

    // Update lead based on type
    type LeadUpdate = {
      status?: string
      lastContactedAt?: Date
      firstEmailSubject?: string
      firstEmailBody?: string
      firstEmailSentAt?: Date
      followUp1Subject?: string
      followUp1Body?: string
      followUp1SentAt?: Date
      followUp2Subject?: string
      followUp2Body?: string
      followUp2SentAt?: Date
      followUp3Subject?: string
      followUp3Body?: string
      followUp3SentAt?: Date
      nextFollowUpAt?: Date
    }
    let leadUpdate: LeadUpdate = { lastContactedAt: now }
    let activityType = 'EMAIL_SENT'

    if (body.type === 'FIRST_EMAIL') {
      leadUpdate = {
        ...leadUpdate,
        status: 'FIRST_EMAIL_SENT',
        firstEmailSubject: body.subject,
        firstEmailBody: body.body,
        firstEmailSentAt: now,
        nextFollowUpAt: addDays(now, day1),
      }
      // Create follow-up tasks
      await prisma.followUpTask.createMany({
        data: [
          { leadId: body.leadId, senderAccountId: body.senderAccountId, type: 'FOLLOW_UP_1', scheduledAt: addDays(now, day1), subject: lead.followUp1Subject || undefined, body: lead.followUp1Body || undefined },
          { leadId: body.leadId, senderAccountId: body.senderAccountId, type: 'FOLLOW_UP_2', scheduledAt: addDays(now, day2), subject: lead.followUp2Subject || undefined, body: lead.followUp2Body || undefined },
          { leadId: body.leadId, senderAccountId: body.senderAccountId, type: 'FOLLOW_UP_3', scheduledAt: addDays(now, day3), subject: lead.followUp3Subject || undefined, body: lead.followUp3Body || undefined },
        ],
      })
    } else if (body.type === 'FOLLOW_UP_1') {
      leadUpdate = { ...leadUpdate, status: 'FOLLOW_UP_1_SENT', followUp1Subject: body.subject, followUp1Body: body.body, followUp1SentAt: now, nextFollowUpAt: addDays(now, day2 - day1) }
      activityType = 'FOLLOW_UP_SENT'
    } else if (body.type === 'FOLLOW_UP_2') {
      leadUpdate = { ...leadUpdate, status: 'FOLLOW_UP_2_SENT', followUp2Subject: body.subject, followUp2Body: body.body, followUp2SentAt: now, nextFollowUpAt: addDays(now, day3 - day2) }
      activityType = 'FOLLOW_UP_SENT'
    } else if (body.type === 'FOLLOW_UP_3') {
      leadUpdate = { ...leadUpdate, status: 'FOLLOW_UP_3_SENT', followUp3Subject: body.subject, followUp3Body: body.body, followUp3SentAt: now }
      activityType = 'FOLLOW_UP_SENT'
    }

    await prisma.lead.update({ where: { id: body.leadId }, data: leadUpdate })

    // Save email message
    await prisma.emailMessage.create({
      data: {
        leadId: body.leadId,
        direction: 'OUTBOUND',
        subject: body.subject,
        body: body.body,
        fromAddress: body.senderAccountId,
        toAddress: lead.companyEmail,
        sentAt: now,
        gmailMessageId: gmailMessage.id || undefined,
        gmailThreadId: gmailMessage.threadId || undefined,
      },
    })

    // Log activity
    await prisma.activity.create({
      data: {
        leadId: body.leadId,
        userId: session.userId,
        senderAccountId: body.senderAccountId,
        type: activityType,
        title: body.subject,
        metadata: { gmailMessageId: gmailMessage.id },
      },
    })

    return NextResponse.json({ ok: true, gmailMessageId: gmailMessage.id })
  } catch (err: unknown) {
    console.error('[email/send]', err)
    const msg = err instanceof Error ? err.message : 'Failed to send email'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
