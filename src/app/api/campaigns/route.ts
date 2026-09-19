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
  senderAccountIds: z.array(z.string()).optional(),
})

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const campaigns = await prisma.campaign.findMany({
    include: {
      senderAccounts: { include: { senderAccount: { select: { id: true, displayName: true, email: true } } } },
      _count: { select: { leads: true, templates: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(campaigns)
}

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = campaignSchema.parse(await req.json())
  const { senderAccountIds, ...rest } = body

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
