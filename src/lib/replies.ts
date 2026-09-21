// Reply + bounce detection. Reads the Gmail threads our emails live in, so a reply is
// caught even if it comes from a different address than the one we emailed.
import type { Lead } from '@prisma/client'
import type { gmail_v1 } from 'googleapis'
import prisma from './prisma'
import { getGmailClientForAccount } from './gmail'
import { STOP_FOLLOWUP_STATUSES } from './utils'

const BOUNCE_FROM = /mailer-daemon|postmaster|mail delivery subsystem/i

export interface ThreadVerdict {
  replied: boolean
  bounced: boolean
  from?: string
  snippet?: string
  messageId?: string
  receivedAt?: Date
}

function header(msg: gmail_v1.Schema$Message, name: string) {
  return msg.payload?.headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || ''
}

/** Look at a thread in the sender's mailbox and decide whether someone answered. */
export async function inspectThread(gmail: gmail_v1.Gmail, threadId: string, senderEmail: string): Promise<ThreadVerdict> {
  const thread = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'metadata',
    metadataHeaders: ['From', 'Subject'],
  })
  for (const msg of thread.data.messages ?? []) {
    const from = header(msg, 'From')
    const isOurs = msg.labelIds?.includes('SENT') || from.toLowerCase().includes(senderEmail.toLowerCase())
    if (isOurs) continue
    const verdict = {
      from,
      snippet: msg.snippet || undefined,
      messageId: msg.id || undefined,
      receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(),
    }
    if (BOUNCE_FROM.test(from)) return { replied: false, bounced: true, ...verdict }
    return { replied: true, bounced: false, ...verdict }
  }
  return { replied: false, bounced: false }
}

/** Stop the sequence and flag the lead. Safe to call more than once. */
export async function recordInbound(lead: Lead, verdict: ThreadVerdict, senderEmail: string) {
  if (verdict.messageId) {
    const seen = await prisma.emailMessage.findUnique({ where: { gmailMessageId: verdict.messageId } })
    if (seen) return false
  }

  await prisma.followUpTask.updateMany({
    where: { leadId: lead.id, status: 'PENDING' },
    data: { status: 'CANCELLED' },
  })

  await prisma.emailMessage.create({
    data: {
      leadId: lead.id,
      direction: 'INBOUND',
      body: verdict.snippet,
      fromAddress: verdict.from,
      toAddress: senderEmail,
      receivedAt: verdict.receivedAt,
      gmailMessageId: verdict.messageId,
    },
  })

  if (verdict.bounced) {
    await prisma.lead.update({ where: { id: lead.id }, data: { status: 'INVALID_EMAIL', nextFollowUpAt: null } })
    if (lead.companyEmail) {
      await prisma.suppressionEntry.upsert({
        where: { email: lead.companyEmail.toLowerCase() },
        create: { email: lead.companyEmail.toLowerCase(), reason: 'BOUNCED' },
        update: {},
      })
    }
    await prisma.activity.create({
      data: { leadId: lead.id, type: 'OTHER', title: 'Email bounced — follow-ups stopped', body: verdict.snippet },
    })
    return true
  }

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status: STOP_FOLLOWUP_STATUSES.includes(lead.status as never) ? lead.status : 'REPLIED',
      hasReplied: true,
      lastResponseAt: verdict.receivedAt,
      nextFollowUpAt: null,
    },
  })
  await prisma.activity.create({
    data: { leadId: lead.id, type: 'EMAIL_REPLIED', title: 'Reply received — follow-ups stopped', body: verdict.snippet },
  })
  await prisma.notification.create({
    data: {
      type: 'REPLY',
      title: `${lead.fullName || lead.companyName} replied`,
      body: verdict.snippet,
      leadId: lead.id,
    },
  })
  return true
}

/** Before sending a follow-up: has this lead already answered in the thread? */
export async function hasReplied(lead: Lead, senderAccountId: string, threadId: string) {
  const sender = await prisma.senderAccount.findUnique({ where: { id: senderAccountId } })
  if (!sender) return false
  const gmail = await getGmailClientForAccount(senderAccountId)
  const verdict = await inspectThread(gmail, threadId, sender.email)
  if (verdict.replied || verdict.bounced) {
    await recordInbound(lead, verdict, sender.email)
    return true
  }
  return false
}

/**
 * Scan every connected mailbox. Checks active threads, plus the inbox for mail from
 * lead addresses (catches replies started as a brand-new email).
 */
export async function checkAllReplies(deadline: number) {
  const result = { accounts: 0, threadsChecked: 0, replies: 0, bounces: 0, errors: [] as string[] }
  const senders = await prisma.senderAccount.findMany({ where: { isActive: true, refreshToken: { not: null } } })

  for (const sender of senders) {
    if (Date.now() > deadline) break
    let gmail: gmail_v1.Gmail
    try {
      gmail = await getGmailClientForAccount(sender.id)
    } catch (err) {
      await flagDisconnected(sender.id, sender.email, err)
      result.errors.push(`${sender.email}: ${err instanceof Error ? err.message : err}`)
      continue
    }
    result.accounts++

    // 1. Threads of leads still in sequence (contacted in the last 45 days)
    const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)
    const messages = await prisma.emailMessage.findMany({
      where: {
        direction: 'OUTBOUND',
        fromAddress: sender.email,
        gmailThreadId: { not: null },
        sentAt: { gte: since },
        lead: { hasReplied: false, status: { notIn: [...STOP_FOLLOWUP_STATUSES, 'INVALID_EMAIL'] } },
      },
      select: { gmailThreadId: true, lead: true },
      orderBy: { sentAt: 'desc' },
      distinct: ['gmailThreadId'],
      take: 150,
    })

    for (const m of messages) {
      if (Date.now() > deadline) break
      try {
        const verdict = await inspectThread(gmail, m.gmailThreadId!, sender.email)
        result.threadsChecked++
        if ((verdict.replied || verdict.bounced) && await recordInbound(m.lead, verdict, sender.email)) {
          if (verdict.bounced) result.bounces++
          else result.replies++
        }
      } catch (err) {
        result.errors.push(`${sender.email} thread ${m.gmailThreadId}: ${err instanceof Error ? err.message : err}`)
      }
    }

    // 2. New emails in the inbox from any lead address
    try {
      const list = await gmail.users.messages.list({ userId: 'me', q: 'in:inbox newer_than:2d', maxResults: 50 })
      const ids = list.data.messages?.map(x => x.id!).filter(Boolean) ?? []
      for (const id of ids) {
        if (Date.now() > deadline) break
        const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From'] })
        const fromEmail = header(msg.data, 'From').match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)?.[0]?.toLowerCase()
        if (!fromEmail) continue
        const lead = await prisma.lead.findFirst({ where: { companyEmail: fromEmail, hasReplied: false } })
        if (!lead) continue
        const recorded = await recordInbound(lead, {
          replied: true, bounced: false,
          from: header(msg.data, 'From'),
          snippet: msg.data.snippet || undefined,
          messageId: msg.data.id || undefined,
          receivedAt: msg.data.internalDate ? new Date(Number(msg.data.internalDate)) : new Date(),
        }, sender.email)
        if (recorded) result.replies++
      }
    } catch (err) {
      result.errors.push(`${sender.email} inbox: ${err instanceof Error ? err.message : err}`)
    }
  }
  return result
}

/** Token revoked/expired → mark the account so the UI shows "Reconnect" and warn once. */
export async function flagDisconnected(senderAccountId: string, email: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  if (!/invalid_grant|refresh token|unauthorized|401/i.test(msg)) return
  const account = await prisma.senderAccount.findUnique({ where: { id: senderAccountId } })
  if (!account || account.gmailStatus === 'EXPIRED') return
  await prisma.senderAccount.update({ where: { id: senderAccountId }, data: { gmailStatus: 'EXPIRED' } })
  await prisma.notification.create({
    data: {
      type: 'GMAIL_ERROR',
      title: `Reconnect ${email}`,
      body: 'Google stopped accepting this account\'s access. Sending and reply tracking are paused for it until you reconnect.',
    },
  })
}
