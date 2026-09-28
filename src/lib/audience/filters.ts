import type { Prisma } from '@prisma/client'

/** Prospect list filters, shared by the table and "apply to all matching" bulk actions */
export function prospectWhere(sp: URLSearchParams): Prisma.ProspectWhereInput {
  const and: Prisma.ProspectWhereInput[] = []
  const q = sp.get('q')?.trim()
  if (q) {
    and.push({
      OR: [
        { displayName: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { handle: { contains: q, mode: 'insensitive' } },
        { company: { contains: q, mode: 'insensitive' } },
        { topic: { contains: q, mode: 'insensitive' } },
        { emails: { some: { email: { contains: q.toLowerCase() } } } },
      ],
    })
  }
  const list = (k: string) => sp.get(k)?.split(',').filter(Boolean) || []
  if (list('relevance').length) and.push({ relevance: { in: list('relevance') } })
  else if (sp.get('hideSpam') !== 'false') and.push({ relevance: { not: 'SPAM' } })
  if (list('persona').length) and.push({ persona: { in: list('persona') } })
  if (list('interest').length) and.push({ interestCategory: { in: list('interest') } })
  if (list('status').length) and.push({ status: { in: list('status') } })
  if (list('region').length) and.push({ region: { in: list('region') } })
  if (sp.get('country') === 'UNKNOWN') and.push({ country: null })
  else if (list('country').length) and.push({ country: { in: list('country') } })
  if (list('platform').length) and.push({ platform: { in: list('platform') } })

  const email = sp.get('email')
  if (email === 'verified') and.push({ emails: { some: { status: 'VERIFIED' } } })
  else if (email === 'any') and.push({ emails: { some: { status: { not: 'INVALID' } } } })
  else if (email === 'none') and.push({ emails: { none: { status: { not: 'INVALID' } } } })
  else if (email === 'business') and.push({ emails: { some: { status: 'VERIFIED', isFree: false } } })

  if (sp.get('identified') === 'true') and.push({ identityScore: { gte: 40 } })
  if (sp.get('identified') === 'false') and.push({ identityScore: { lt: 40 } })
  const minIntent = Number(sp.get('minIntent') || 0)
  if (minIntent > 0) and.push({ intentScore: { gte: minIntent } })
  if (sp.get('ownChannelAi') === 'true') and.push({ ownChannelAi: true })

  const channelId = sp.get('channelId')
  const videoId = sp.get('videoId')
  if (videoId) and.push({ comments: { some: { videoId } } })
  else if (channelId) and.push({ comments: { some: { video: { channelId } } } })
  if (sp.get('enriched') === 'true') and.push({ enrichedAt: { not: null } })
  if (sp.get('enriched') === 'false') and.push({ enrichedAt: null })

  // Intelligence (PRD M3/M5): what they build, fit, opportunity, freshness, stage
  if (list('useCase').length) and.push({ useCase: { in: list('useCase') } })
  if (list('forWhom').length) and.push({ forWhom: { in: list('forWhom') } })
  if (list('stage').length) and.push({ buildStage: { in: list('stage') } })
  if (list('discovery').length) and.push({ discoveryStage: { in: list('discovery') } })
  const vertical = sp.get('vertical')?.trim()
  if (vertical) and.push({ vertical: { contains: vertical, mode: 'insensitive' } })
  const minFit = Number(sp.get('minFit') || 0)
  if (minFit > 0) and.push({ fitScore: { gte: minFit } })
  const minOpp = Number(sp.get('minOpportunity') || 0)
  if (minOpp > 0) and.push({ opportunityScore: { gte: minOpp } })
  const minReach = Number(sp.get('minReach') || 0)
  if (minReach > 0) and.push({ reachability: { gte: minReach } })
  const fresh = Number(sp.get('freshDays') || 0)
  if (fresh > 0) and.push({ lastEngagedAt: { gte: new Date(Date.now() - fresh * 86_400_000) } })
  if (list('channelIds').length) and.push({ comments: { some: { video: { channel: { id: { in: list('channelIds') } } } } } })
  if (sp.get('inauthentic') === 'true') and.push({ inauthentic: true })
  else if (sp.get('inauthentic') !== 'any') and.push({ inauthentic: false })
  if (sp.get('qra') === 'true') and.push({ intentScore: { gte: 60 }, fitScore: { gte: 60 }, reachability: { gte: 80 } })
  if (sp.get('warmTouch') === 'true') and.push({ warmTouch: { in: ['TODO', 'TOUCHED', 'RESPONDED'] } })
  return and.length ? { AND: and } : {}
}

export function prospectOrder(sort?: string | null): Prisma.ProspectOrderByWithRelationInput[] {
  switch (sort) {
    case 'recent': return [{ lastSeenAt: 'desc' }]
    case 'subscribers': return [{ subscriberCount: 'desc' }]
    case 'comments': return [{ commentCount: 'desc' }, { score: 'desc' }]
    case 'opportunity': return [{ opportunityScore: 'desc' }, { intentScore: 'desc' }]
    case 'fit': return [{ fitScore: 'desc' }, { intentScore: 'desc' }]
    case 'fresh': return [{ lastEngagedAt: { sort: 'desc', nulls: 'last' } }]
    default: return [{ score: 'desc' }, { lastSeenAt: 'desc' }]
  }
}
