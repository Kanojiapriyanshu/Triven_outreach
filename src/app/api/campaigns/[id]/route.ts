import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { z } from 'zod'

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  industry: z.string().trim().min(1).optional(),
  targetCountry: z.string().optional(),
  targetLocation: z.string().optional(),
  product: z.string().optional(),
  description: z.string().optional(),
  timezone: z.string().optional(),
  followUpDay1: z.number().int().min(1).optional(),
  followUpDay2: z.number().int().min(1).optional(),
  followUpDay3: z.number().int().min(1).optional(),
  dailyNewLeads: z.number().int().min(1).max(1000).optional(),
  sendingStatus: z.enum(['DRAFT', 'ACTIVE', 'PAUSED']).optional(),
  isPaused: z.boolean().optional(),
  senderAccountIds: z.array(z.string()).optional(),
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      senderAccounts: { include: { senderAccount: true } },
      templates: true,
      _count: { select: { leads: true } },
    },
  })

  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(campaign)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message || 'Invalid update' }, { status: 400 })
  const { senderAccountIds, ...rest } = parsed.data

  // Launching: make sure it can actually send before switching it on
  if (rest.sendingStatus === 'ACTIVE') {
    const current = await prisma.campaign.findUnique({ where: { id }, include: { senderAccounts: { include: { senderAccount: true } } } })
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const template = await prisma.emailTemplate.findFirst({ where: { type: 'FIRST_EMAIL', OR: [{ campaignId: id }, { campaignId: null }] } })
    if (!template) return NextResponse.json({ error: 'Add a first-email template (Templates page) before launching.' }, { status: 400 })
    const chosen = senderAccountIds ?? current.senderAccounts.map((s) => s.senderAccountId)
    const connected = await prisma.senderAccount.count({
      where: { gmailStatus: 'CONNECTED', isActive: true, ...(chosen.length ? { id: { in: chosen } } : {}) },
    })
    if (!connected) return NextResponse.json({ error: 'None of this campaign\'s inboxes are connected to Gmail.' }, { status: 400 })
    if (!current.launchedAt) (rest as Record<string, unknown>).launchedAt = new Date()
  }

  const campaign = await prisma.campaign.update({
    where: { id },
    data: {
      ...rest,
      ...(senderAccountIds !== undefined && {
        senderAccounts: {
          deleteMany: {},
          create: senderAccountIds.map((sid: string) => ({ senderAccountId: sid })),
        },
      }),
    },
    include: {
      senderAccounts: { include: { senderAccount: { select: { id: true, displayName: true, email: true } } } },
      _count: { select: { leads: true } },
    },
  })

  return NextResponse.json(campaign)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  await prisma.campaign.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
