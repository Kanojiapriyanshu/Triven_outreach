import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

const senderSchema = z.object({
  displayName: z.string().min(1),
  email: z.string().email(),
  dailyEmailTarget: z.number().int().min(1).max(500).optional(),
  timezone: z.string().optional(),
  signature: z.string().optional(),
  isActive: z.boolean().optional(),
})

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accounts = await prisma.senderAccount.findMany({
    include: {
      _count: { select: { leads: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(accounts)
}

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = senderSchema.parse(await req.json())

  const existing = await prisma.senderAccount.findUnique({ where: { email: body.email.toLowerCase() } })
  if (existing) return NextResponse.json({ error: 'Sender account with this email already exists' }, { status: 409 })

  const account = await prisma.senderAccount.create({
    data: { ...body, email: body.email.toLowerCase() },
    include: { _count: { select: { leads: true } } },
  })

  return NextResponse.json(account, { status: 201 })
}
