// Follow-up sending logic shared by the cron worker and the manual "Send" button.
import prisma from './prisma'
import { sendGmail, getMessageIdHeader } from './gmail'
import { buildTemplateVars, renderTemplate, pickDefaultTemplate, FOLLOW_UP_TYPES } from './template'
import { STOP_FOLLOWUP_STATUSES } from './utils'
import type { LeadStatus } from '@/types'

const SENT_STATUS: Record<string, string> = {
  FOLLOW_UP_1: 'FOLLOW_UP_1_SENT',
  FOLLOW_UP_2: 'FOLLOW_UP_2_SENT',
  FOLLOW_UP_3: 'FOLLOW_UP_3_SENT',
}

const SENT_AT_FIELD: Record<string, string> = {
  FOLLOW_UP_1: 'followUp1',
  FOLLOW_UP_2: 'followUp2',
  FOLLOW_UP_3: 'followUp3',
}

export type FollowUpResult =
  | { outcome: 'sent'; gmailMessageId?: string | null }
  | { outcome: 'skipped' | 'failed'; reason: string }

/**
 * Send one follow-up task as a reply in the lead's original Gmail thread.
 * Body resolution: override → task body → best matching template. No body → task is skipped.
 */
export async function sendFollowUpTask(
  taskId: string,
  opts: { bodyOverride?: string; userId?: string; auto?: boolean } = {},
): Promise<FollowUpResult> {
  const task = await prisma.followUpTask.findUnique({
    where: { id: taskId },
    include: { lead: true },
  })
  if (!task) return { outcome: 'failed', reason: 'Follow-up not found' }
  if (task.status !== 'PENDING') return { outcome: 'skipped', reason: `Already ${task.status.toLowerCase()}` }

  const { lead } = task
  const skip = async (reason: string): Promise<FollowUpResult> => {
    await prisma.followUpTask.update({ where: { id: task.id }, data: { status: 'SKIPPED' } })
    await refreshNextFollowUp(lead.id)
    return { outcome: 'skipped', reason }
  }

  if (STOP_FOLLOWUP_STATUSES.includes(lead.status as LeadStatus) || lead.hasReplied) {
    return skip(`Lead is ${lead.status}`)
  }
  if (!lead.companyEmail) return skip('Lead has no email address')

  const senderAccountId = task.senderAccountId || lead.senderAccountId
  if (!senderAccountId) return skip('No sender account assigned')

  const suppressed = await prisma.suppressionEntry.findFirst({ where: { email: lead.companyEmail.toLowerCase() } })
  if (suppressed) return skip('Email is on suppression list')

  let rawBody = opts.bodyOverride?.trim() || task.body?.trim() || ''
  if (!rawBody) {
    const templates = await prisma.emailTemplate.findMany({ where: { type: task.type } })
    rawBody = pickDefaultTemplate(templates, task.type, lead.campaignId)?.body?.trim() || ''
  }
  if (!rawBody) return skip(`No ${task.type.replace(/_/g, ' ').toLowerCase()} template — create one in Templates`)

  // Reply inside the first email's thread
  const firstMessage = await prisma.emailMessage.findFirst({
    where: { leadId: lead.id, direction: 'OUTBOUND', gmailThreadId: { not: null } },
    orderBy: { createdAt: 'asc' },
  })
  const baseSubject = lead.firstEmailSubject || firstMessage?.subject || task.subject || 'Following up'
  const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`
  const inReplyTo = firstMessage?.gmailMessageId
    ? await getMessageIdHeader(senderAccountId, firstMessage.gmailMessageId)
    : undefined

  const sender = await prisma.senderAccount.findUnique({ where: { id: senderAccountId } })
  const body = renderTemplate(rawBody, buildTemplateVars(lead, sender))

  try {
    const gmailMessage = await sendGmail({
      senderAccountId,
      to: lead.companyEmail,
      subject,
      body,
      threadId: firstMessage?.gmailThreadId || undefined,
      inReplyTo,
    })

    const now = new Date()
    await prisma.followUpTask.update({
      where: { id: task.id },
      data: { status: 'SENT', sentAt: now, subject, body },
    })

    const prefix = SENT_AT_FIELD[task.type]
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        status: SENT_STATUS[task.type] || undefined,
        lastContactedAt: now,
        ...(prefix ? { [`${prefix}Subject`]: subject, [`${prefix}Body`]: body, [`${prefix}SentAt`]: now } : {}),
      },
    })
    await refreshNextFollowUp(lead.id)

    await prisma.emailMessage.create({
      data: {
        leadId: lead.id,
        direction: 'OUTBOUND',
        subject,
        body,
        fromAddress: sender?.email,
        toAddress: lead.companyEmail,
        sentAt: now,
        gmailMessageId: gmailMessage.id || undefined,
        gmailThreadId: gmailMessage.threadId || undefined,
      },
    })

    await prisma.activity.create({
      data: {
        leadId: lead.id,
        userId: opts.userId,
        senderAccountId,
        type: 'FOLLOW_UP_SENT',
        title: `${task.type.replace(/_/g, ' ').replace('FOLLOW UP', 'Follow-up')} sent${opts.auto ? ' (auto)' : ''}`,
        body: subject,
        metadata: { gmailMessageId: gmailMessage.id, taskId: task.id, auto: !!opts.auto },
      },
    })

    return { outcome: 'sent', gmailMessageId: gmailMessage.id }
  } catch (err) {
    return { outcome: 'failed', reason: err instanceof Error ? err.message : String(err) }
  }
}

/** Keep lead.nextFollowUpAt pointing at the earliest pending follow-up (or null). */
export async function refreshNextFollowUp(leadId: string) {
  const next = await prisma.followUpTask.findFirst({
    where: { leadId, status: 'PENDING', type: { in: FOLLOW_UP_TYPES } },
    orderBy: { scheduledAt: 'asc' },
  })
  await prisma.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: next?.scheduledAt ?? null } })
}
