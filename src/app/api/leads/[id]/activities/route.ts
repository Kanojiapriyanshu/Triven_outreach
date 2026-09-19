import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const activities = await prisma.activity.findMany({
    where: { leadId: id },
    include: {
      user: { select: { id: true, name: true } },
      senderAccount: { select: { id: true, displayName: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(activities)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { type, title, body } = await req.json()

  const activity = await prisma.activity.create({
    data: { leadId: id, userId: session.userId, type: type || 'NOTE_ADDED', title, body },
    include: { user: { select: { id: true, name: true } } },
  })

  return NextResponse.json(activity, { status: 201 })
}
