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
  body?: string
  subject?: string
  messageId?: string
  threadId?: string
  receivedAt?: Date
}

function decode(data?: string | null) {
  return data ? Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8') : ''
}

function findPart(part: gmail_v1.Schema$MessagePart | undefined, mime: string): string {
  if (!part) return ''
  if (part.mimeType === mime && part.body?.data) return decode(part.body.data)
  for (const p of part.parts ?? []) {
    const found = findPart(p, mime)
    if (found) return found
  }
  return ''
}

/** Keep only what they wrote: drop the quoted history and signatures separators */
export function stripQuoted(text: string) {
  let clean = text.replace(/\r\n/g, '\n')
  // "On Mon, 21 Sept 2026, 10:11 pm Kate <kate@x.com>\nwrote:": phone apps wrap this line
  const header = clean.match(/(^|\n)[ \t]*On [^\n]{5,250}?(?:\n[^\n]{0,150}?)?(wrote|schrieb|a écrit|escribió):[ \t]*(\n|$)/)
  if (header?.index !== undefined) clean = clean.slice(0, header.index)
  const lines = clean.split('\n')
  const out: string[] = []
  for (const line of lines) {
    if (/^On .{5,200}(wrote|schrieb|a écrit|escribió):?\s*$/i.test(line.trim())) break
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break
    if (/^From:\s.+/i.test(line.trim()) && out.length > 2) break
    if (/^_{5,}$/.test(line.trim())) break
    if (line.startsWith('>')) continue
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Full plain text of a Gmail message (falls back to de-tagged HTML, then the snippet) */
export async function messageText(gmail: gmail_v1.Gmail, id: string) {
  try {
    const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' })
    let text = findPart(msg.data.payload, 'text/plain')
    if (!text) {
      text = findPart(msg.data.payload, 'text/html')
        .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div)>/gi, '\n').replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    }
    return stripQuoted(text) || msg.data.snippet || ''
  } catch {
    return ''
  }
}

function header(msg: gmail_v1.Schema$Message, name: string) {
  return msg.payload?.headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || ''
}

function isAutoReply(msg: gmail_v1.Schema$Message) {
  const auto = header(msg, 'Auto-Submitted').toLowerCase()
  if (auto && auto !== 'no') return true
  if (header(msg, 'X-Autoreply') || header(msg, 'X-Autorespond')) return true
  if (/^(auto_reply|bulk)$/i.test(header(msg, 'Precedence'))) return true
  return /^(out of (the )?office|automatic reply|auto.?reply|autoreply|away from (the )?office|on vacation|abwesenheit)/i
    .test(header(msg, 'Subject'))
}

/** Look at a thread in the sender's mailbox and decide whether someone answered. */
export async function inspectThread(gmail: gmail_v1.Gmail, threadId: string, senderEmail: string): Promise<ThreadVerdict> {
  const thread = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'metadata',
    metadataHeaders: ['From', 'Subject', 'Auto-Submitted', 'X-Autoreply', 'X-Autorespond', 'Precedence'],
  })
  for (const msg of thread.data.messages ?? []) {
    const from = header(msg, 'From')
    const isOurs = msg.labelIds?.includes('SENT') || from.toLowerCase().includes(senderEmail.toLowerCase())
    if (isOurs) continue
    // Out-of-office / vacation auto-replies are not real replies: keep the sequence going
    if (isAutoReply(msg) && !BOUNCE_FROM.test(from)) continue
    const verdict = {
      from,
      snippet: msg.snippet || undefined,
      subject: header(msg, 'Subject') || undefined,
      messageId: msg.id || undefined,
      threadId: msg.threadId || threadId,
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
      subject: verdict.subject,
      body: verdict.body || verdict.snippet,
      fromAddress: verdict.from,
      toAddress: senderEmail,
      receivedAt: verdict.receivedAt,
      gmailMessageId: verdict.messageId,
      gmailThreadId: verdict.threadId,
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
    if (verdict.messageId) verdict.body = await messageText(gmail, verdict.messageId)
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
  // Remember when Gmail was last checked (shown in the Inbox, throttles manual syncs)
  const at = new Date().toISOString()
  await prisma.setting.upsert({ where: { key: 'lastInboxSync' }, create: { key: 'lastInboxSync', value: at }, update: { value: at } })
  const result = { accounts: 0, threadsChecked: 0, replies: 0, bounces: 0, synced: 0, errors: [] as string[] }
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
      take: 300,
    })

    // Shuffle: each run has a short time budget, so random order means every thread
    // gets checked within a few runs instead of only the newest ones
    for (let i = messages.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[messages[i], messages[j]] = [messages[j], messages[i]]
    }

    for (const m of messages) {
      if (Date.now() > deadline) break
      try {
        const verdict = await inspectThread(gmail, m.gmailThreadId!, sender.email)
        result.threadsChecked++
        if ((verdict.replied || verdict.bounced) && verdict.messageId) verdict.body = await messageText(gmail, verdict.messageId)
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
        const msg = await gmail.users.messages.get({
          userId: 'me', id, format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Auto-Submitted', 'X-Autoreply', 'X-Autorespond', 'Precedence'],
        })
        if (isAutoReply(msg.data)) continue
        const fromEmail = header(msg.data, 'From').match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)?.[0]?.toLowerCase()
        if (!fromEmail) continue
        const lead = await prisma.lead.findFirst({ where: { companyEmail: fromEmail, hasReplied: false } })
        if (!lead) continue
        const recorded = await recordInbound(lead, {
          replied: true, bounced: false,
          from: header(msg.data, 'From'),
          subject: header(msg.data, 'Subject') || undefined,
          snippet: msg.data.snippet || undefined,
          body: await messageText(gmail, id),
          messageId: msg.data.id || undefined,
          threadId: msg.data.threadId || undefined,
          receivedAt: msg.data.internalDate ? new Date(Number(msg.data.internalDate)) : new Date(),
        }, sender.email)
        if (recorded) result.replies++
      }
    } catch (err) {
      result.errors.push(`${sender.email} inbox: ${err instanceof Error ? err.message : err}`)
    }

    // 3. Ongoing conversations: mirror every new message in threads where the lead replied
    try {
      result.synced += await syncConversations(gmail, sender.email, deadline)
    } catch (err) {
      result.errors.push(`${sender.email} sync: ${err instanceof Error ? err.message : err}`)
    }
  }
  return result
}

/**
 * Keep the CRM inbox a mirror of Gmail for leads that replied: their new replies, and
 * anything you sent them straight from Gmail, are copied in (full text, deduped by id).
 */
export async function syncConversations(gmail: gmail_v1.Gmail, senderEmail: string, deadline: number) {
  const since = new Date(Date.now() - 30 * 86_400_000)
  const threads = await prisma.emailMessage.findMany({
    where: {
      gmailThreadId: { not: null },
      lead: { hasReplied: true, lastResponseAt: { gte: since }, senderAccount: { email: senderEmail } },
    },
    select: { gmailThreadId: true, leadId: true },
    distinct: ['gmailThreadId'],
    take: 60,
  })
  let added = 0
  for (const t of threads.sort(() => Math.random() - 0.5)) {
    if (Date.now() > deadline) break
    const thread = await gmail.users.threads.get({
      userId: 'me', id: t.gmailThreadId!, format: 'metadata',
      metadataHeaders: ['From', 'To', 'Subject', 'Auto-Submitted', 'X-Autoreply', 'X-Autorespond', 'Precedence'],
    })
    for (const msg of thread.data.messages ?? []) {
      if (!msg.id) continue
      if (await prisma.emailMessage.findUnique({ where: { gmailMessageId: msg.id }, select: { id: true } })) continue
      const from = header(msg, 'From')
      const ours = msg.labelIds?.includes('SENT') || from.toLowerCase().includes(senderEmail.toLowerCase())
      const at = msg.internalDate ? new Date(Number(msg.internalDate)) : new Date()
      const body = await messageText(gmail, msg.id)
      await prisma.emailMessage.create({
        data: {
          leadId: t.leadId,
          direction: ours ? 'OUTBOUND' : 'INBOUND',
          subject: header(msg, 'Subject') || undefined,
          body,
          fromAddress: ours ? senderEmail : from,
          toAddress: ours ? header(msg, 'To') : senderEmail,
          sentAt: ours ? at : undefined,
          receivedAt: ours ? undefined : at,
          isRead: ours,
          gmailMessageId: msg.id,
          gmailThreadId: t.gmailThreadId,
        },
      })
      added++
      if (!ours && !isAutoReply(msg)) {
        await prisma.lead.update({ where: { id: t.leadId }, data: { lastResponseAt: at } })
        await prisma.notification.create({
          data: { type: 'REPLY', title: 'New reply in a conversation', body: body.slice(0, 200), leadId: t.leadId },
        })
      }
    }
  }
  return added
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
