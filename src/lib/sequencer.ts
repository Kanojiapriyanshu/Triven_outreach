// Instantly-style sequencer. Every run, each inbox that is "free" (its random gap since the
// last email has passed, and it has daily allowance left) sends exactly ONE email:
//   1. an email the user scheduled for a specific time (any time of day)
//   2. a follow-up that is due (send window only, same inbox as the first email)
//   3. the next queued lead from an ACTIVE campaign (send window only)
// Inboxes take turns (least recently used first), so volume is spread evenly.
import type { SenderAccount } from '@prisma/client'
import prisma from './prisma'
import { getSettings, type OutreachSettings } from './settings'
import { isInSendWindow } from './send-window'
import { dailyAllowance, deliverEmail, assertSendable, scheduleFollowUps, OutreachError } from './outreach'
import { sendTask, refreshNextFollowUp, SCHEDULED_EMAIL_TYPES } from './followups'
import { pickDefaultTemplate, FOLLOW_UP_TYPES } from './template'
import { flagDisconnected } from './replies'

const QUEUED_STATUSES = ['NEW', 'READY_TO_CONTACT', 'RESEARCHING']
const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

export interface SequencerResult {
  inWindow: boolean
  sent: { first: number; followUps: number; scheduled: number }
  skipped: number
  inboxes: Array<{ email: string; status: string }>
  errors: string[]
}

/** Stable pseudo-random gap for the message that was just sent (so every run agrees) */
function gapFor(messageId: string, s: OutreachSettings) {
  let h = 0
  for (const c of messageId) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const span = Math.max(0, s.maxGapMinutes - s.minGapMinutes)
  return (s.minGapMinutes + (span ? h % (span + 1) : 0)) * 60_000
}

export async function runSequencer(deadline: number): Promise<SequencerResult> {
  const settings = await getSettings()
  const now = new Date()
  const inWindow = isInSendWindow(now, settings.sendWindow)
  const result: SequencerResult = { inWindow, sent: { first: 0, followUps: 0, scheduled: 0 }, skipped: 0, inboxes: [], errors: [] }

  const senders = await prisma.senderAccount.findMany({ where: { isActive: true, gmailStatus: 'CONNECTED' } })

  // When did each inbox last send, and is its gap over?
  const inboxes = await Promise.all(senders.map(async (sender) => {
    const last = await prisma.emailMessage.findFirst({
      where: { direction: 'OUTBOUND', fromAddress: sender.email },
      orderBy: { sentAt: 'desc' },
      select: { id: true, sentAt: true },
    })
    const freeAt = last?.sentAt ? last.sentAt.getTime() + gapFor(last.id, settings) : 0
    const allowance = await dailyAllowance(sender, settings.dailyCapPerSender)
    return { sender, lastAt: last?.sentAt?.getTime() ?? 0, freeAt, allowance }
  }))
  inboxes.sort((a, b) => a.lastAt - b.lastAt) // least recently used first

  // Campaign queue state for this run
  const campaigns = await prisma.campaign.findMany({
    where: { sendingStatus: 'ACTIVE' },
    include: { senderAccounts: { select: { senderAccountId: true } } },
  })
  const sentToday = new Map<string, number>()
  for (const c of campaigns) {
    sentToday.set(c.id, await prisma.lead.count({
      where: { campaignId: c.id, firstEmailSentAt: { gte: new Date(Date.now() - 86_400_000) } },
    }))
  }
  const firstTemplates = await prisma.emailTemplate.findMany({ where: { type: 'FIRST_EMAIL' } })
  const blockedCampaigns = new Set<string>()

  for (const inbox of inboxes) {
    const { sender, allowance } = inbox
    if (Date.now() > deadline) { result.inboxes.push({ email: sender.email, status: 'out of time' }); continue }
    if (allowance.left <= 0) { result.inboxes.push({ email: sender.email, status: `daily limit reached (${allowance.used}/${allowance.limit})` }); continue }
    if (inbox.freeAt > Date.now()) {
      result.inboxes.push({ email: sender.email, status: `waiting ${Math.ceil((inbox.freeAt - Date.now()) / 60_000)} min (gap)` })
      continue
    }

    const status = await sendOne(sender, { inWindow, settings, campaigns, sentToday, firstTemplates, blockedCampaigns, result, deadline })
    result.inboxes.push({ email: sender.email, status })
  }

  // Follow-ups whose lead has no inbox at all can never send: close them out
  const orphans = await prisma.followUpTask.findMany({
    where: { status: 'PENDING', scheduledAt: { lte: now }, senderAccountId: null, lead: { senderAccountId: null } },
    select: { id: true },
    take: 20,
  })
  for (const o of orphans) { await sendTask(o.id, { auto: true }); result.skipped++ }

  return result
}

/** Try the jobs for one inbox in priority order until one email actually goes out. */
async function sendOne(
  sender: SenderAccount,
  ctx: {
    inWindow: boolean
    settings: OutreachSettings
    campaigns: Array<{ id: string; name: string; dailyNewLeads: number; followUpDay1: number; followUpDay2: number; followUpDay3: number; senderAccounts: Array<{ senderAccountId: string }> }>
    sentToday: Map<string, number>
    firstTemplates: Array<{ id: string; type: string; campaignId: string | null; isDefault: boolean; subject: string; body: string }>
    blockedCampaigns: Set<string>
    result: SequencerResult
    deadline: number
  },
): Promise<string> {
  const { result } = ctx
  const mine = { OR: [{ senderAccountId: sender.id }, { senderAccountId: null, lead: { senderAccountId: sender.id } }] }

  for (let attempt = 0; attempt < 4 && Date.now() < ctx.deadline; attempt++) {
    // 1. Emails scheduled for an exact time
    const scheduled = await prisma.followUpTask.findFirst({
      where: { status: 'PENDING', type: { in: SCHEDULED_EMAIL_TYPES }, scheduledAt: { lte: new Date() }, ...mine },
      orderBy: { scheduledAt: 'asc' },
    })
    if (scheduled) {
      const r = await sendTask(scheduled.id, { auto: true })
      if (r.outcome === 'sent') { result.sent.scheduled++; return 'sent scheduled email' }
      if (r.outcome === 'failed') { result.errors.push(`${sender.email}: ${r.reason}`); return 'error' }
      if (r.outcome === 'deferred') return `waiting: ${r.reason}`
      result.skipped++
      continue
    }

    if (!ctx.inWindow) return 'outside send window'

    // 2. Follow-ups that are due
    const followUp = await prisma.followUpTask.findFirst({
      where: {
        status: 'PENDING',
        type: { in: FOLLOW_UP_TYPES },
        scheduledAt: { lte: new Date() },
        // Pausing a campaign pauses its follow-ups too
        lead: { firstEmailSentAt: { not: null }, NOT: [{ campaign: { is: { sendingStatus: 'PAUSED' } } }] },
        ...mine,
      },
      orderBy: { scheduledAt: 'asc' },
    })
    if (followUp) {
      const r = await sendTask(followUp.id, { auto: true })
      if (r.outcome === 'sent') { result.sent.followUps++; return 'sent follow-up' }
      if (r.outcome === 'failed') { result.errors.push(`${sender.email}: ${r.reason}`); return 'error' }
      if (r.outcome === 'deferred') return `waiting: ${r.reason}`
      result.skipped++
      continue
    }

    // 3. Next queued lead from an active campaign this inbox belongs to
    const eligible = ctx.campaigns.filter((c) =>
      !ctx.blockedCampaigns.has(c.id)
      && (ctx.sentToday.get(c.id) ?? 0) < c.dailyNewLeads
      && (c.senderAccounts.length === 0 || c.senderAccounts.some((s) => s.senderAccountId === sender.id)))
    if (!eligible.length) return 'nothing to send'

    const candidates = await prisma.lead.findMany({
      where: {
        campaignId: { in: eligible.map((c) => c.id) },
        firstEmailSentAt: null,
        companyEmail: { not: null },
        hasReplied: false,
        status: { in: QUEUED_STATUSES },
        followUpTasks: { none: { type: 'FIRST_EMAIL', status: 'PENDING' } },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    })
    if (!candidates.length) return 'queue empty'
    // Like Instantly, the inbox is decided at send time: any free inbox takes the next lead,
    // preferring leads already assigned to it, then higher priority, then oldest
    candidates.sort((a, b) =>
      Number(b.senderAccountId === sender.id) - Number(a.senderAccountId === sender.id)
      || (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2))
    const lead = candidates[0]
    const campaign = eligible.find((c) => c.id === lead.campaignId)!

    const template = pickDefaultTemplate(ctx.firstTemplates, 'FIRST_EMAIL', campaign.id)
    if (!template) {
      ctx.blockedCampaigns.add(campaign.id)
      result.errors.push(`Campaign "${campaign.name}" has no first-email template. Add one in Templates.`)
      continue
    }

    try {
      await assertSendable(lead, sender)
      await deliverEmail({ lead, sender, subject: template.subject, body: template.body, kind: 'FIRST_EMAIL', auto: true })
      await scheduleFollowUps({
        leadId: lead.id,
        senderAccountId: sender.id,
        base: new Date(),
        plan: [campaign.followUpDay1, campaign.followUpDay2, campaign.followUpDay3].map((delayDays, i) => ({ step: i + 1, delayDays })),
        window: ctx.settings.sendWindow,
      })
      await refreshNextFollowUp(lead.id)
      ctx.sentToday.set(campaign.id, (ctx.sentToday.get(campaign.id) ?? 0) + 1)
      result.sent.first++
      return `sent first email to ${lead.companyEmail}`
    } catch (err) {
      if (err instanceof OutreachError) {
        if (err.retryable) return `waiting: ${err.message}`
        result.skipped++ // lead was marked invalid / do-not-contact; try the next one
        continue
      }
      await flagDisconnected(sender.id, sender.email, err)
      result.errors.push(`${sender.email} → ${lead.companyEmail}: ${err instanceof Error ? err.message : err}`)
      return 'error'
    }
  }
  return 'nothing sent'
}
