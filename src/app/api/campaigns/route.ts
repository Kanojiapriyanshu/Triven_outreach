import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

const campaignSchema = z.object({
  name: z.string().min(1),
  industry: z.string().min(1),
  targetCountry: z.string().optional(),
  targetLocation: z.string().optional(),
  product: z.string().optional(),
  description: z.string().optional(),
  timezone: z.string().optional(),
  followUpDay1: z.number().int().min(1).optional(),
  followUpDay2: z.number().int().min(1).optional(),
  followUpDay3: z.number().int().min(1).optional(),
  dailyNewLeads: z.number().int().min(1).max(1000).optional(),
  windowStart: z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/, 'Use HH:mm').nullish(),
  windowEnd: z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/, 'Use HH:mm').nullish(),
  sendDays: z.string().regex(/^[1-7](,[1-7])*$/, 'Pick at least one day').nullish(),
  gapMinMinutes: z.number().int().min(1).max(240).nullish(),
  gapMaxMinutes: z.number().int().min(1).max(240).nullish(),
  senderAccountIds: z.array(z.string()).optional(),
})

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const campaigns = await prisma.campaign.findMany({
    include: {
      senderAccounts: { include: { senderAccount: { select: { id: true, displayName: true, email: true, gmailStatus: true } } } },
      _count: { select: { leads: true, templates: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Live numbers per campaign, Instantly-style
  const dayAgo = new Date(Date.now() - 86_400_000)
  const withStats = await Promise.all(campaigns.map(async (c) => {
    const [queued, noEmail, contacted, sentToday, replied, bounced, followUpsPending] = await Promise.all([
      prisma.lead.count({ where: { campaignId: c.id, firstEmailSentAt: null, companyEmail: { not: null }, hasReplied: false, status: { in: ['NEW', 'READY_TO_CONTACT', 'RESEARCHING'] } } }),
      prisma.lead.count({ where: { campaignId: c.id, companyEmail: null } }),
      prisma.lead.count({ where: { campaignId: c.id, firstEmailSentAt: { not: null } } }),
      prisma.lead.count({ where: { campaignId: c.id, firstEmailSentAt: { gte: dayAgo } } }),
      prisma.lead.count({ where: { campaignId: c.id, hasReplied: true } }),
      prisma.lead.count({ where: { campaignId: c.id, status: 'INVALID_EMAIL' } }),
      prisma.followUpTask.count({ where: { status: 'PENDING', lead: { campaignId: c.id } } }),
    ])
    return { ...c, stats: { queued, noEmail, contacted, sentToday, replied, bounced, followUpsPending } }
  }))

  return NextResponse.json(withStats)
}

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = campaignSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message || 'Invalid campaign' }, { status: 400 })
  const { senderAccountIds, ...rest } = parsed.data

  const campaign = await prisma.campaign.create({
    data: {
      ...rest,
      senderAccounts: senderAccountIds?.length
        ? {
            create: senderAccountIds.map((id) => ({ senderAccountId: id })),
          }
        : undefined,
    },
    include: {
      senderAccounts: { include: { senderAccount: { select: { id: true, displayName: true, email: true } } } },
      _count: { select: { leads: true } },
    },
  })

  return NextResponse.json(campaign, { status: 201 })
}
