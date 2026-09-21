// Core outreach actions shared by the API routes and the background worker.
import type { Lead, SenderAccount } from '@prisma/client'
import { promises as dns } from 'dns'
import prisma from './prisma'
import { sendGmail } from './gmail'
import { buildTemplateVars, renderTemplate, FOLLOW_UP_TYPES } from './template'
import { windowSlotAfterDays, type SendWindow } from './send-window'
import { getSettings } from './settings'

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
  if (suppressed) {
    await prisma.lead.update({ where: { id: lead.id }, data: { status: 'DO_NOT_CONTACT', nextFollowUpAt: null } })
    throw new OutreachError('This email is on the do-not-contact list')
  }

  // Bounces hurt the sending account's reputation more than anything: never email a dead domain
  if (!(await domainAcceptsMail(email.split('@')[1]))) {
    await prisma.lead.update({ where: { id: lead.id }, data: { status: 'INVALID_EMAIL', nextFollowUpAt: null } })
    await prisma.followUpTask.updateMany({ where: { leadId: lead.id, status: 'PENDING' }, data: { status: 'CANCELLED' } })
    throw new OutreachError(`${email.split('@')[1]} can't receive email (no mail server). Lead marked invalid.`)
  }
  return sender
}

const mxCache = new Map<string, boolean>()

/** Does this domain have a mail server? DNS errors other than "doesn't exist" count as yes. */
export async function domainAcceptsMail(domain: string) {
  if (mxCache.has(domain)) return mxCache.get(domain)!
  let ok = true
  try {
    const mx = await dns.resolveMx(domain)
    ok = mx.some((r) => r.exchange && r.exchange !== '.')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      // No MX: RFC 5321 falls back to an A record
      ok = await dns.resolve4(domain).then((a) => a.length > 0).catch(() => false)
    }
  }
  mxCache.set(domain, ok)
  return ok
}

/**
 * How many emails this account may send today. New accounts ramp up slowly
 * (5 → 10 → 20 → 30 a day by week), because a fresh Gmail suddenly sending cold
 * email is the #1 reason mail lands in spam.
 */
export async function dailyAllowance(sender: { email: string; dailyEmailTarget: number }, globalCap: number) {
  const first = await prisma.emailMessage.findFirst({
    where: { direction: 'OUTBOUND', fromAddress: sender.email },
    orderBy: { sentAt: 'asc' },
    select: { sentAt: true },
  })
  const days = first?.sentAt ? Math.floor((Date.now() - first.sentAt.getTime()) / 86_400_000) : 0
  const ramp = days < 7 ? 5 : days < 14 ? 10 : days < 21 ? 20 : days < 28 ? 30 : Infinity
  const limit = Math.min(ramp, globalCap, sender.dailyEmailTarget || globalCap)
  const used = await sentInLast24h(sender.email)
  return { limit, used, left: Math.max(0, limit - used), warmingUp: ramp !== Infinity, warmupDay: days + 1 }
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
  const { demoPhone } = await getSettings()
  const vars = buildTemplateVars(lead, sender, { demoPhone })
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
      // The inbox that sent the first email owns the conversation (follow-ups reply from it)
      senderAccountId: kind === 'FIRST_EMAIL' ? sender.id : lead.senderAccountId || sender.id,
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
