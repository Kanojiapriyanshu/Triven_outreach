/**
 * GET  /api/audience/segments → saved segments with live counts
 * POST /api/audience/segments { name, filters, campaignId?, autoFeed?, dailyCap? }
 *      or { preview: filters } → counts only (for the builder)
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { segmentStats } from '@/lib/audience/segments'

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  filters: z.record(z.string()).optional(),
  preview: z.record(z.string()).optional(),
  campaignId: z.string().nullish(),
  autoFeed: z.boolean().optional(),
  dailyCap: z.number().int().min(1).max(500).optional(),
})

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const segs = await prisma.audienceSegment.findMany({ orderBy: { createdAt: 'desc' } })
  const campaigns = new Map((await prisma.campaign.findMany({ select: { id: true, name: true, sendingStatus: true } })).map((c) => [c.id, c]))
  const out = await Promise.all(segs.map(async (s) => ({ ...s, campaign: s.campaignId ? campaigns.get(s.campaignId) || null : null, stats: await segmentStats(s.filters as Record<string, string>) })))
  return NextResponse.json(out)
}

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  const d = parsed.data
  if (d.preview) return NextResponse.json(await segmentStats(d.preview))
  if (!d.name || !d.filters) return NextResponse.json({ error: 'Name and filters are required' }, { status: 400 })
  const seg = await prisma.audienceSegment.create({
    data: { name: d.name, filters: d.filters as Prisma.InputJsonValue, campaignId: d.campaignId || null, autoFeed: !!d.autoFeed, dailyCap: d.dailyCap || 30 },
  })
  const stats = await segmentStats(d.filters)
  await prisma.audienceSegment.update({ where: { id: seg.id }, data: { lastCount: stats.total } })
  return NextResponse.json({ ...seg, count: stats.total, stats }, { status: 201 })
}
