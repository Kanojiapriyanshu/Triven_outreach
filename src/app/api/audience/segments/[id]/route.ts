/**
 * PATCH  /api/audience/segments/:id { name?, filters?, campaignId?, autoFeed?, dailyCap? }
 * POST   /api/audience/segments/:id → feed its campaign now
 * DELETE /api/audience/segments/:id
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { feedSegment } from '@/lib/audience/segments'

export const maxDuration = 60

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  filters: z.record(z.string()).optional(),
  campaignId: z.string().nullish(),
  autoFeed: z.boolean().optional(),
  dailyCap: z.number().int().min(1).max(500).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  const { filters, ...rest } = parsed.data
  const seg = await prisma.audienceSegment.update({ where: { id }, data: { ...rest, ...(filters ? { filters: filters as Prisma.InputJsonValue } : {}) } })
  // Keep the campaign pointing at its feeding segment (shown on the campaign)
  if (rest.campaignId) await prisma.campaign.update({ where: { id: rest.campaignId }, data: { segmentId: id } }).catch(() => null)
  return NextResponse.json(seg)
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const seg = await prisma.audienceSegment.findUnique({ where: { id } })
  if (!seg) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(await feedSegment({ ...seg, autoFeed: true }))
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  await prisma.audienceSegment.delete({ where: { id } }).catch(() => null)
  await prisma.campaign.updateMany({ where: { segmentId: id }, data: { segmentId: null } })
  return NextResponse.json({ ok: true })
}
