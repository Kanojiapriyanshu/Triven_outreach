// How much each campaign can send today, how much it has sent, and — when it's idle — the
// single real reason why. Shown on Campaigns and System Health so "why isn't it sending?"
// never needs a developer.
import prisma from './prisma'
import { getSettings } from './settings'
import { campaignSchedule } from './schedule'
import { currentOrNextWindow, isInSendWindow, fmtInZone } from './send-window'
import { dailyAllowance } from './outreach'
import { minutesSinceLast } from './worker-log'

export interface CampaignCapacity {
  id: string
  name: string
  status: string
  queued: number
  sentToday: number
  dailyNewLeads: number
  capacityToday: number
  inboxes: number
  windowOpen: boolean
  nextWindow: string | null
  state: 'SENDING' | 'IDLE' | 'BLOCKED' | 'OFF'
  reason: string
}

const QUEUED = ['NEW', 'READY_TO_CONTACT', 'RESEARCHING']

export async function campaignCapacity(): Promise<CampaignCapacity[]> {
  const settings = await getSettings()
  const now = new Date()
  const dayAgo = new Date(Date.now() - 86_400_000)
  const [campaigns, senders, generalTemplate, tickAge] = await Promise.all([
    prisma.campaign.findMany({ include: { senderAccounts: { select: { senderAccountId: true } }, _count: { select: { templates: { where: { type: 'FIRST_EMAIL' } } } } }, orderBy: { createdAt: 'desc' } }),
    prisma.senderAccount.findMany({ where: { isActive: true, gmailStatus: 'CONNECTED' } }),
    prisma.emailTemplate.count({ where: { type: 'FIRST_EMAIL', campaignId: null } }),
    minutesSinceLast('tick'),
  ])
  const live = senders.filter((s) => !s.pausedUntil || s.pausedUntil < now)
  const allowance = new Map(await Promise.all(live.map(async (s) => [s.id, await dailyAllowance(s, settings.dailyCapPerSender, settings.warmupStart)] as const)))

  return Promise.all(campaigns.map(async (c) => {
    const [queued, sentToday] = await Promise.all([
      prisma.lead.count({ where: { campaignId: c.id, firstEmailSentAt: null, companyEmail: { not: null }, hasReplied: false, status: { in: QUEUED } } }),
      prisma.lead.count({ where: { campaignId: c.id, firstEmailSentAt: { gte: dayAgo } } }),
    ])
    const mine = c.senderAccounts.length ? live.filter((s) => c.senderAccounts.some((x) => x.senderAccountId === s.id)) : live
    const left = mine.reduce((n, s) => n + (allowance.get(s.id)?.left || 0), 0)
    const schedule = campaignSchedule(c, settings)
    const windowOpen = c.recipientHours || isInSendWindow(now, schedule.window)
    const next = currentOrNextWindow(now, schedule.window)
    const capacityToday = Math.min(c.dailyNewLeads, sentToday + left)
    const base = {
      id: c.id, name: c.name, status: c.sendingStatus, queued, sentToday, dailyNewLeads: c.dailyNewLeads, capacityToday,
      inboxes: mine.length, windowOpen, nextWindow: next && !windowOpen ? fmtInZone(next.start, schedule.window) : null,
    }
    const out = (state: CampaignCapacity['state'], reason: string): CampaignCapacity => ({ ...base, state, reason })

    if (c.sendingStatus === 'DRAFT') return out('OFF', queued ? `Draft: ${queued} leads waiting. Review the emails and launch.` : 'Draft')
    if (c.sendingStatus === 'PAUSED') return out('OFF', c.pausedReason ? `Paused: ${c.pausedReason}` : 'Paused')
    if (!mine.length) return out('BLOCKED', 'No connected inbox (or all paused for bounces)')
    if (!c._count.templates && !generalTemplate) return out('BLOCKED', 'No first-email template')
    if (tickAge === null || tickAge > 15) return out('BLOCKED', tickAge === null ? 'The worker has never run: set up the scheduler (System Health)' : `The worker hasn't run for ${tickAge} min: check the scheduler (System Health)`)
    if (!queued) return out('IDLE', 'No one left to email: add leads or attach a segment')
    if (sentToday >= c.dailyNewLeads) return out('IDLE', `Daily limit reached (${sentToday}/${c.dailyNewLeads})`)
    if (!left) return out('IDLE', 'All its inboxes are at today\'s limit (warm-up / daily cap)')
    if (!windowOpen) return out('IDLE', `Outside sending hours${base.nextWindow ? ` · next window ${base.nextWindow}` : ''}`)
    return out('SENDING', `Sending: ${queued} queued, ${capacityToday - sentToday} more today`)
  }))
}
