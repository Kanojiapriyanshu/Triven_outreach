import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { prospectWhere, prospectOrder } from '@/lib/audience/filters'

export async function GET(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const page = Math.max(1, Number(sp.get('page') || 1))
  const pageSize = Math.min(200, Math.max(10, Number(sp.get('pageSize') || 50)))
  const where = prospectWhere(sp)

  const [total, rows] = await Promise.all([
    prisma.prospect.count({ where }),
    prisma.prospect.findMany({
      where,
      orderBy: prospectOrder(sp.get('sort')),
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, displayName: true, firstName: true, lastName: true, handle: true, avatarUrl: true, youtubeChannelId: true,
        country: true, region: true, company: true, jobTitle: true, website: true, linkedIn: true, github: true, twitter: true,
        persona: true, interestCategory: true, relevance: true, score: true, topic: true, reason: true, status: true,
        commentCount: true, subscriberCount: true, consentSensitive: true, enrichedAt: true, aiCheckedAt: true, lastSeenAt: true,
        intentScore: true, intentEvidence: true, identityScore: true, ownChannelAi: true,
        platform: true, profileUrl: true, countrySource: true, countryConfidence: true,
        emails: { select: { id: true, email: true, status: true, source: true, isPrimary: true, isFree: true }, orderBy: { createdAt: 'asc' } },
        lead: { select: { id: true, status: true, campaign: { select: { name: true } } } },
        comments: { orderBy: { score: 'desc' }, take: 1, select: { text: true, video: { select: { title: true, channel: { select: { title: true } } } } } },
      },
    }),
  ])
  return NextResponse.json({ data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
}
