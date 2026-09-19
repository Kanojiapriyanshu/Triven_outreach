import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { STOP_FOLLOWUP_STATUSES } from '@/lib/utils'
import type { LeadStatus } from '@/types'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      campaign: true,
      senderAccount: { select: { id: true, displayName: true, email: true, gmailStatus: true } },
      assignedUser: { select: { id: true, name: true, email: true } },
      activities: { orderBy: { createdAt: 'desc' }, take: 50 },
      followUpTasks: { orderBy: { scheduledAt: 'asc' } },
      emailMessages: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  })

  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(lead)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  const existing = await prisma.lead.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const oldStatus = existing.status as LeadStatus
  const newStatus = body.status as LeadStatus | undefined

  // If status is changing to a terminal one, cancel pending follow-ups
  if (newStatus && newStatus !== oldStatus && STOP_FOLLOWUP_STATUSES.includes(newStatus)) {
    await prisma.followUpTask.updateMany({
      where: { leadId: id, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    })
  }

  // Auto-set hasReplied/isInterested flags
  const patch: Record<string, unknown> = { ...body }
  if (newStatus === 'REPLIED') patch.hasReplied = true
  if (newStatus === 'INTERESTED') { patch.hasReplied = true; patch.isInterested = true }
  if (newStatus === 'WON') { patch.hasSale = true; if (!body.saleDate) patch.saleDate = new Date() }

  const lead = await prisma.lead.update({
    where: { id },
    data: patch,
    include: {
      campaign: { select: { id: true, name: true } },
      senderAccount: { select: { id: true, displayName: true, email: true } },
    },
  })

  // Log status change
  if (newStatus && newStatus !== oldStatus) {
    await prisma.activity.create({
      data: {
        leadId: id,
        userId: session.userId,
        type: 'STATUS_CHANGED',
        title: `Status changed to ${newStatus}`,
        metadata: { from: oldStatus, to: newStatus },
      },
    })
  }

  return NextResponse.json(lead)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  await prisma.lead.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
