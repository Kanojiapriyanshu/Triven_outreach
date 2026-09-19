import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

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
  const body = await req.json()
  const { senderAccountIds, ...rest } = body

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
