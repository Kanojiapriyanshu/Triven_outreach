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
  return and.length ? { AND: and } : {}
}

export function prospectOrder(sort?: string | null): Prisma.ProspectOrderByWithRelationInput[] {
  switch (sort) {
    case 'recent': return [{ lastSeenAt: 'desc' }]
    case 'subscribers': return [{ subscriberCount: 'desc' }]
    case 'comments': return [{ commentCount: 'desc' }, { score: 'desc' }]
    default: return [{ score: 'desc' }, { lastSeenAt: 'desc' }]
  }
}
