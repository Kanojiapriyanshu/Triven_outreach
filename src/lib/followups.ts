// Sending of queued tasks (scheduled emails + follow-ups), shared by the cron worker
// and the manual "Send now" buttons.
import prisma from './prisma'
import { sendGmail, getMessageIdHeader } from './gmail'
import { buildTemplateVars, renderTemplate, pickDefaultTemplate, FOLLOW_UP_TYPES } from './template'
import { STOP_FOLLOWUP_STATUSES } from './utils'
import { deliverEmail, assertSendable, OutreachError, type EmailKind } from './outreach'
import { hasReplied, flagDisconnected } from './replies'
import type { LeadStatus } from '@/types'

const SENT_STATUS: Record<string, string> = {
  FOLLOW_UP_1: 'FOLLOW_UP_1_SENT',
  FOLLOW_UP_2: 'FOLLOW_UP_2_SENT',
  FOLLOW_UP_3: 'FOLLOW_UP_3_SENT',
}

const SENT_FIELD: Record<string, string> = {
  FOLLOW_UP_1: 'followUp1',
  FOLLOW_UP_2: 'followUp2',
  FOLLOW_UP_3: 'followUp3',
}

export type TaskResult =
  | { outcome: 'sent'; gmailMessageId?: string | null }
  | { outcome: 'deferred'; reason: string } // stays PENDING, retried later
  | { outcome: 'skipped' | 'failed'; reason: string }

export const SCHEDULED_EMAIL_TYPES = ['FIRST_EMAIL', 'OTHER']

/** Send any queued task by id. */
export async function sendTask(taskId: string, opts: { bodyOverride?: string; userId?: string; auto?: boolean } = {}) {
  const task = await prisma.followUpTask.findUnique({ where: { id: taskId }, select: { type: true } })
  if (!task) return { outcome: 'failed', reason: 'Task not found' } as TaskResult
  return SCHEDULED_EMAIL_TYPES.includes(task.type)
    ? sendScheduledEmailTask(taskId, opts)
    : sendFollowUpTask(taskId, opts)
}

async function skipTask(taskId: string, leadId: string, reason: string): Promise<TaskResult> {
  await prisma.followUpTask.update({ where: { id: taskId }, data: { status: 'SKIPPED' } })
  await refreshNextFollowUp(leadId)
  return { outcome: 'skipped', reason }
}

/** A first email / one-off email the user scheduled for later. */
export async function sendScheduledEmailTask(
  taskId: string,
  opts: { userId?: string; auto?: boolean } = {},
): Promise<TaskResult> {
  const task = await prisma.followUpTask.findUnique({ where: { id: taskId }, include: { lead: true, senderAccount: true } })
  if (!task) return { outcome: 'failed', reason: 'Task not found' }
  if (task.status !== 'PENDING') return { outcome: 'skipped', reason: `Already ${task.status.toLowerCase()}` }
  if (!task.subject || !task.body) return skipTask(task.id, task.leadId, 'Scheduled email has no content')
  if (task.lead.hasReplied || STOP_FOLLOWUP_STATUSES.includes(task.lead.status as LeadStatus)) {
    return skipTask(task.id, task.leadId, `Lead is ${task.lead.status}`)
  }

  try {
    const sender = await assertSendable(task.lead, task.senderAccount)
    const kind = (task.type === 'FIRST_EMAIL' && !task.lead.firstEmailSentAt ? 'FIRST_EMAIL' : 'OTHER') as EmailKind
    const sent = await deliverEmail({
      lead: task.lead, sender, subject: task.subject, body: task.body, kind, userId: opts.userId, auto: opts.auto,
    })
    await prisma.followUpTask.update({ where: { id: task.id }, data: { status: 'SENT', sentAt: new Date() } })
    await refreshNextFollowUp(task.leadId)
    return { outcome: 'sent', gmailMessageId: sent.gmailMessageId }
  } catch (err) {
    if (err instanceof OutreachError) {
      return err.retryable ? { outcome: 'deferred', reason: err.message } : skipTask(task.id, task.leadId, err.message)
    }
    if (task.senderAccountId) await flagDisconnected(task.senderAccountId, task.senderAccount?.email || '', err)
    return { outcome: 'failed', reason: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Send one follow-up as a reply in the lead's original Gmail thread.
 * Body resolution: override → task body → best matching template. No body → task is skipped.
 */
export async function sendFollowUpTask(
  taskId: string,
  opts: { bodyOverride?: string; userId?: string; auto?: boolean } = {},
): Promise<TaskResult> {
  const task = await prisma.followUpTask.findUnique({ where: { id: taskId }, include: { lead: true } })
  if (!task) return { outcome: 'failed', reason: 'Follow-up not found' }
  if (task.status !== 'PENDING') return { outcome: 'skipped', reason: `Already ${task.status.toLowerCase()}` }

  const { lead } = task
  const skip = (reason: string) => skipTask(task.id, lead.id, reason)

  if (STOP_FOLLOWUP_STATUSES.includes(lead.status as LeadStatus) || lead.hasReplied) return skip(`Lead is ${lead.status}`)
  if (!lead.companyEmail) return skip('Lead has no email address')

  // The first email hasn't gone out yet (e.g. it is scheduled) — wait for it
  if (!lead.firstEmailSentAt) {
    const firstPending = await prisma.followUpTask.count({ where: { leadId: lead.id, type: 'FIRST_EMAIL', status: 'PENDING' } })
    return firstPending ? { outcome: 'deferred', reason: 'First email not sent yet' } : skip('First email was never sent')
  }

  const senderAccountId = task.senderAccountId || lead.senderAccountId
  if (!senderAccountId) return skip('No sender account assigned')
  const sender = await prisma.senderAccount.findUnique({ where: { id: senderAccountId } })

  let rawBody = opts.bodyOverride?.trim() || task.body?.trim() || ''
  if (!rawBody) {
    const templates = await prisma.emailTemplate.findMany({ where: { type: task.type } })
    rawBody = pickDefaultTemplate(templates, task.type, lead.campaignId)?.body?.trim() || ''
  }
  if (!rawBody) return skip(`No ${task.type.replace(/_/g, ' ').toLowerCase()} template. Create one in Templates.`)

  // Reply inside the first email's thread
  const firstMessage = await prisma.emailMessage.findFirst({
    where: { leadId: lead.id, direction: 'OUTBOUND', gmailThreadId: { not: null } },
    orderBy: { createdAt: 'asc' },
  })
  const baseSubject = lead.firstEmailSubject || firstMessage?.subject || task.subject || 'Following up'
  const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`

  try {
    await assertSendable(lead, sender)

    // Last-second safety net: never follow up on someone who already answered
    if (firstMessage?.gmailThreadId && await hasReplied(lead, senderAccountId, firstMessage.gmailThreadId)) {
      return { outcome: 'skipped', reason: 'Lead replied — follow-ups stopped' }
    }

    const inReplyTo = firstMessage?.gmailMessageId
      ? await getMessageIdHeader(senderAccountId, firstMessage.gmailMessageId)
      : undefined
    const body = renderTemplate(rawBody, buildTemplateVars(lead, sender))

    const gmailMessage = await sendGmail({
      senderAccountId,
      to: lead.companyEmail,
      subject,
      body,
      threadId: firstMessage?.gmailThreadId || undefined,
      inReplyTo,
    })

    const now = new Date()
    await prisma.followUpTask.update({ where: { id: task.id }, data: { status: 'SENT', sentAt: now, subject, body } })

    const prefix = SENT_FIELD[task.type]
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
    if (err instanceof OutreachError) return err.retryable ? { outcome: 'deferred', reason: err.message } : skip(err.message)
    await flagDisconnected(senderAccountId, sender?.email || '', err)
    return { outcome: 'failed', reason: err instanceof Error ? err.message : String(err) }
  }
}

/** Keep lead.nextFollowUpAt pointing at the earliest pending task (or null). */
export async function refreshNextFollowUp(leadId: string) {
  const next = await prisma.followUpTask.findFirst({
    where: { leadId, status: 'PENDING', type: { in: [...FOLLOW_UP_TYPES, ...SCHEDULED_EMAIL_TYPES] } },
    orderBy: { scheduledAt: 'asc' },
  })
  await prisma.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: next?.scheduledAt ?? null } })
}
