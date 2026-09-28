// Segments (PRD M5): saved prospect filters with live counts, an explanation of who is
// excluded and why, and an optional daily feed into a campaign.
import type { AudienceSegment } from '@prisma/client'
import prisma from '../prisma'
import { prospectWhere } from './filters'
import { pushToCampaign } from './actions'

export type SegmentFilters = Record<string, string>

const STAGE_LABEL: Record<string, string> = {
  COLLECTED: 'not qualified yet', QUALIFIED: 'not researched yet', RESEARCHED: 'identity not confirmed', IDENTITY_CONFIRMED: 'no email found yet',
  EMAIL_CANDIDATES: 'email not confirmed', VERIFIED: 'blocked by email / country rules', NOT_QUALIFIED: 'low intent', UNREACHABLE: 'no way to reach them',
  SUSPECTED_INAUTHENTIC: 'suspected paid engagement', DO_NOT_CONTACT: 'do not contact', CONTACTED: 'already in a campaign',
}

/** How many match, how many are ready, and why the rest aren't */
export async function segmentStats(filters: SegmentFilters) {
  const where = prospectWhere(new URLSearchParams(filters))
  const [total, ready, stages] = await Promise.all([
    prisma.prospect.count({ where }),
    prisma.prospect.count({ where: { AND: [where, { status: 'READY_TO_CONTACT' }, { lead: null }] } }),
    prisma.prospect.groupBy({ by: ['discoveryStage'], where: { AND: [where, { status: { not: 'READY_TO_CONTACT' } }] }, _count: true }),
  ])
  const excluded = stages
    .map((s) => ({ stage: s.discoveryStage, label: STAGE_LABEL[s.discoveryStage] || s.discoveryStage.toLowerCase(), count: s._count }))
    .sort((a, b) => b.count - a.count)
  return { total, ready, excluded }
}

/** Add today's share of ready people to the segment's campaign (never re-adds anyone) */
export async function feedSegment(seg: AudienceSegment) {
  if (!seg.campaignId || !seg.autoFeed) return { added: 0, skipped: 'feed off' }
  const campaign = await prisma.campaign.findUnique({ where: { id: seg.campaignId }, select: { sendingStatus: true } })
  if (campaign?.sendingStatus !== 'ACTIVE') return { added: 0, skipped: 'campaign not sending' }
  const sameDay = seg.lastRunAt && seg.lastRunAt.toDateString() === new Date().toDateString()
  const room = seg.dailyCap - (sameDay ? seg.lastAdded : 0)
  if (room <= 0) return { added: 0, skipped: 'daily cap reached' }
  const where = prospectWhere(new URLSearchParams(seg.filters as SegmentFilters))
  const ids = (await prisma.prospect.findMany({
    where: { AND: [where, { status: 'READY_TO_CONTACT' }, { lead: null }, { inauthentic: false }] },
    orderBy: { opportunityScore: 'desc' }, take: room, select: { id: true },
  })).map((p) => p.id)
  const r = ids.length ? await pushToCampaign(ids, { campaignId: seg.campaignId }) : { added: 0 }
  const count = await prisma.prospect.count({ where })
  await prisma.audienceSegment.update({
    where: { id: seg.id },
    data: { lastRunAt: new Date(), lastAdded: (sameDay ? seg.lastAdded : 0) + r.added, lastCount: count },
  })
  return { added: r.added }
}

export async function runSegmentFeeds() {
  const segs = await prisma.audienceSegment.findMany({ where: { autoFeed: true, campaignId: { not: null } } })
  const out: Record<string, unknown> = {}
  for (const s of segs) out[s.name] = await feedSegment(s).catch((e) => ({ error: (e as Error).message }))
  return out
}
