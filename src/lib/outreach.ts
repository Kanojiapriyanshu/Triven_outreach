// Core outreach actions shared by the API routes and the background worker.
import type { Lead, SenderAccount } from '@prisma/client'
import prisma from './prisma'
import { sendGmail } from './gmail'
import { buildTemplateVars, renderTemplate, FOLLOW_UP_TYPES } from './template'
import { windowSlotAfterDays, type SendWindow } from './send-window'

export type EmailKind = 'FIRST_EMAIL' | 'OTHER'

export interface FollowUpPlanStep {
  step: number        // 1-3
  delayDays: number   // days after the first email
  body?: string | null // raw template; empty = use the default template when due
}

/** A reason not to send. `retryable` = try again later (e.g. Gmail needs reconnecting). */
export class OutreachError extends Error {
  constructor(message: string, public retryable = false) {
    super(message)
  }
}

/** Throws OutreachError if this lead can't be emailed from this sender right now. */
export async function assertSendable(lead: Lead, sender: SenderAccount | null): Promise<SenderAccount> {
  if (!lead.companyEmail) throw new OutreachError('This lead has no email address')
  if (!sender) throw new OutreachError('Sender account not found')
  if (sender.gmailStatus !== 'CONNECTED') {
    throw new OutreachError(`${sender.email} is not connected to Gmail. Reconnect it in Sender Accounts.`, true)
  }
  const email = lead.companyEmail.toLowerCase()
  const suppressed = await prisma.suppressionEntry.findFirst({
    where: { OR: [{ email }, { domain: email.split('@')[1] }] },
  })
  if (suppressed) throw new OutreachError('This email is on the do-not-contact list')
  return sender
}

/** Render + send a first email or one-off email, and record it everywhere. */
export async function deliverEmail(opts: {
  lead: Lead
  sender: SenderAccount
  subject: string
  body: string
  kind: EmailKind
  userId?: string
  auto?: boolean
}) {
  const { lead, sender, kind } = opts
  const vars = buildTemplateVars(lead, sender)
  const subject = renderTemplate(opts.subject, vars)
  const body = renderTemplate(opts.body, vars)

  const gmailMessage = await sendGmail({ senderAccountId: sender.id, to: lead.companyEmail!, subject, body })
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
      ...(kind === 'FIRST_EMAIL'
        ? { status: 'FIRST_EMAIL_SENT', firstEmailSubject: subject, firstEmailBody: body, firstEmailSentAt: now }
        : {}),
    },
  })

  await prisma.activity.create({
    data: {
      leadId: lead.id,
      userId: opts.userId,
      senderAccountId: sender.id,
      type: 'EMAIL_SENT',
      title: `${kind === 'FIRST_EMAIL' ? 'First email' : 'Email'} sent${opts.auto ? ' (scheduled)' : ''}: ${subject}`,
      metadata: { gmailMessageId: gmailMessage.id, auto: !!opts.auto },
    },
  })

  return { gmailMessageId: gmailMessage.id, subject }
}

/**
 * Replace the lead's pending follow-ups with a new plan. Each follow-up lands in the
 * send window `delayDays` after `base` (the first email's send time).
 */
export async function scheduleFollowUps(opts: {
  leadId: string
  senderAccountId: string
  base: Date
  plan: FollowUpPlanStep[]
  window: SendWindow
}) {
  await prisma.followUpTask.updateMany({
    where: { leadId: opts.leadId, status: 'PENDING', type: { in: FOLLOW_UP_TYPES } },
    data: { status: 'CANCELLED' },
  })
  if (!opts.plan.length) return 0

  await prisma.followUpTask.createMany({
    data: opts.plan.map(f => ({
      leadId: opts.leadId,
      senderAccountId: opts.senderAccountId,
      type: FOLLOW_UP_TYPES[f.step - 1],
      scheduledAt: windowSlotAfterDays(opts.base, f.delayDays, opts.window),
      body: f.body?.trim() || null,
    })),
  })
  return opts.plan.length
}

/** Emails this account sent in the last 24h (all kinds) — used for the daily cap. */
export async function sentInLast24h(senderEmail: string) {
  return prisma.emailMessage.count({
    where: {
      direction: 'OUTBOUND',
      fromAddress: senderEmail,
      sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  })
}
