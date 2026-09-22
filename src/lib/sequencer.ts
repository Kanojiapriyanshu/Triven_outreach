// Instantly-style sequencer. Every run, each inbox that is "free" (its own gap since its
// last email has passed, and it has daily allowance left) sends at most ONE email:
//   1. an email scheduled for an exact time (bulk sends are pre-paced, any time of day)
//   2. a follow-up that is due, inside its campaign's window, respecting the campaign gap
//   3. the next queued lead from an ACTIVE campaign, same window + gap rules
// Inboxes take turns (least recently used first). A campaign's "gap between emails" spaces
// its emails across all inboxes: e.g. 3–4 min means one email, switch inbox, 3–4 min, next.
import type { SenderAccount, Campaign } from '@prisma/client'
import prisma from './prisma'
import { getSettings, type OutreachSettings } from './settings'
import { isInSendWindow } from './send-window'
import { campaignSchedule, gapAfter, type EffectiveSchedule } from './schedule'
import { dailyAllowance, deliverEmail, assertSendable, scheduleFollowUps, OutreachError } from './outreach'
import { sendTask, refreshNextFollowUp, SCHEDULED_EMAIL_TYPES } from './followups'
import { pickDefaultTemplate, FOLLOW_UP_TYPES } from './template'
import { flagDisconnected } from './replies'

const QUEUED_STATUSES = ['NEW', 'READY_TO_CONTACT', 'RESEARCHING']
const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
const NO_CAMPAIGN = '__none'

export interface SequencerResult {
  inWindow: boolean
  sent: { first: number; followUps: number; scheduled: number }
  skipped: number
  inboxes: Array<{ email: string; status: string }>
  campaigns: Array<{ name: string; status: string }>
  errors: string[]
}

interface Lane {
  campaign: (Campaign & { senderAccounts: Array<{ senderAccountId: string }> }) | null
  schedule: EffectiveSchedule
  open: boolean      // inside its sending window right now
  freeAt: number     // campaign gap: no email for this campaign before this time
  sentToday: number
  blocked: boolean
}

export async function runSequencer(deadline: number): Promise<SequencerResult> {
  const settings = await getSettings()
  const now = new Date()
  const result: SequencerResult = {
    inWindow: isInSendWindow(now, settings.sendWindow),
    sent: { first: 0, followUps: 0, scheduled: 0 }, skipped: 0, inboxes: [], campaigns: [], errors: [],
  }

  // ── Lanes: one per campaign (own schedule) + one for leads without a campaign ──
  const campaigns = await prisma.campaign.findMany({ include: { senderAccounts: { select: { senderAccountId: true } } } })
  const lanes = new Map<string, Lane>()
  lanes.set(NO_CAMPAIGN, { campaign: null, schedule: campaignSchedule(null, settings), open: result.inWindow, freeAt: 0, sentToday: 0, blocked: false })
  for (const c of campaigns) {
    const schedule = campaignSchedule(c, settings)
    let freeAt = 0
    if (schedule.gap) {
      const last = await prisma.emailMessage.findFirst({
        where: { direction: 'OUTBOUND', lead: { campaignId: c.id } },
        orderBy: { sentAt: 'desc' },
        select: { id: true, sentAt: true },
      })
      if (last?.sentAt) freeAt = last.sentAt.getTime() + gapAfter(last.id, schedule.gap.min, schedule.gap.max)
    }
    const sentToday = c.sendingStatus === 'ACTIVE'
      ? await prisma.lead.count({ where: { campaignId: c.id, firstEmailSentAt: { gte: new Date(Date.now() - 86_400_000) } } })
      : 0
    lanes.set(c.id, { campaign: c, schedule, open: isInSendWindow(now, schedule.window), freeAt, sentToday, blocked: false })
  }
  for (const l of lanes.values()) {
    if (!l.campaign) continue
    const waiting = l.freeAt > Date.now() ? `next email in ${Math.ceil((l.freeAt - Date.now()) / 60_000)} min` : 'ready'
    result.campaigns.push({ name: l.campaign.name, status: `${l.campaign.sendingStatus.toLowerCase()} · ${l.open ? 'window open' : 'window closed'} · ${waiting}` })
  }

  // ── Inboxes: least recently used first; each needs its own gap + allowance ──
  const senders = await prisma.senderAccount.findMany({ where: { isActive: true, gmailStatus: 'CONNECTED' } })
  const inboxes = await Promise.all(senders.map(async (sender) => {
    const last = await prisma.emailMessage.findFirst({
      where: { direction: 'OUTBOUND', fromAddress: sender.email },
      orderBy: { sentAt: 'desc' },
      select: { id: true, sentAt: true },
    })
    const freeAt = last?.sentAt ? last.sentAt.getTime() + gapAfter(last.id, settings.minGapMinutes, settings.maxGapMinutes) : 0
    const allowance = await dailyAllowance(sender, settings.dailyCapPerSender)
    return { sender, lastAt: last?.sentAt?.getTime() ?? 0, freeAt, allowance }
  }))
  inboxes.sort((a, b) => a.lastAt - b.lastAt)

  const firstTemplates = await prisma.emailTemplate.findMany({ where: { type: 'FIRST_EMAIL' } })

  for (const inbox of inboxes) {
    const { sender, allowance } = inbox
    if (Date.now() > deadline) { result.inboxes.push({ email: sender.email, status: 'out of time' }); continue }
    if (allowance.left <= 0) { result.inboxes.push({ email: sender.email, status: `daily limit reached (${allowance.used}/${allowance.limit})` }); continue }
    if (inbox.freeAt > Date.now()) {
      result.inboxes.push({ email: sender.email, status: `resting ${Math.ceil((inbox.freeAt - Date.now()) / 60_000)} min` })
      continue
    }
    const status = await sendOne(sender, { settings, lanes, firstTemplates, result, deadline })
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

/** Can this lane send right now? (window open, campaign gap passed) */
function laneReady(lane: Lane | undefined) {
  return !!lane && lane.open && !lane.blocked && lane.freeAt <= Date.now()
}

/** After a send, hold the lane until its gap has passed (so one run never double-sends it) */
function markSent(lane: Lane) {
  if (lane.schedule.gap) lane.freeAt = Date.now() + lane.schedule.gap.min * 60_000
}

async function sendOne(
  sender: SenderAccount,
  ctx: {
    settings: OutreachSettings
    lanes: Map<string, Lane>
    firstTemplates: Array<{ id: string; type: string; campaignId: string | null; isDefault: boolean; subject: string; body: string }>
    result: SequencerResult
    deadline: number
  },
): Promise<string> {
  const { result, lanes } = ctx
  const mine = { OR: [{ senderAccountId: sender.id }, { senderAccountId: null, lead: { senderAccountId: sender.id } }] }
  const laneOf = (campaignId: string | null) => lanes.get(campaignId ?? NO_CAMPAIGN)

  for (let attempt = 0; attempt < 4 && Date.now() < ctx.deadline; attempt++) {
    // 1. Emails scheduled for an exact time (bulk sends were paced when they were queued)
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

    // 2. Due follow-ups whose campaign is open and not pacing
    const dueFollowUps = await prisma.followUpTask.findMany({
      where: {
        status: 'PENDING',
        type: { in: FOLLOW_UP_TYPES },
        scheduledAt: { lte: new Date() },
        // Pausing a campaign pauses its follow-ups too
        lead: { firstEmailSentAt: { not: null }, NOT: [{ campaign: { is: { sendingStatus: 'PAUSED' } } }] },
        ...mine,
      },
      include: { lead: { select: { campaignId: true } } },
      orderBy: { scheduledAt: 'asc' },
      take: 25,
    })
    const followUp = dueFollowUps.find((t) => laneReady(laneOf(t.lead.campaignId)))
    if (followUp) {
      const r = await sendTask(followUp.id, { auto: true })
      if (r.outcome === 'sent') {
        markSent(laneOf(followUp.lead.campaignId)!)
        result.sent.followUps++
        return 'sent follow-up'
      }
      if (r.outcome === 'failed') { result.errors.push(`${sender.email}: ${r.reason}`); return 'error' }
      if (r.outcome === 'deferred') return `waiting: ${r.reason}`
      result.skipped++
      continue
    }

    // 3. Next queued lead from an active campaign this inbox belongs to
    const eligible = [...lanes.values()].filter((l) =>
      l.campaign
      && l.campaign.sendingStatus === 'ACTIVE'
      && laneReady(l)
      && l.sentToday < l.campaign.dailyNewLeads
      && (l.campaign.senderAccounts.length === 0 || l.campaign.senderAccounts.some((s) => s.senderAccountId === sender.id)))
    if (!eligible.length) return dueFollowUps.length ? 'follow-ups waiting for their window/gap' : 'nothing to send now'

    const candidates = await prisma.lead.findMany({
      where: {
        campaignId: { in: eligible.map((l) => l.campaign!.id) },
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
    const lane = laneOf(lead.campaignId)!
    const campaign = lane.campaign!

    const template = pickDefaultTemplate(ctx.firstTemplates, 'FIRST_EMAIL', campaign.id)
    if (!template) {
      lane.blocked = true
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
        window: lane.schedule.window,
      })
      await refreshNextFollowUp(lead.id)
      lane.sentToday++
      markSent(lane)
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
