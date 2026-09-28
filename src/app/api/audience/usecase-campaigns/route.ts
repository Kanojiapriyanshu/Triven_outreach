/**
 * GET  /api/audience/usecase-campaigns → the eight use-case campaigns and whether they exist
 * POST /api/audience/usecase-campaigns → create the missing ones (drafts, each with its sequence)
 */
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { ensureUseCaseCampaigns, USE_CASE_CAMPAIGNS } from '@/lib/audience/routing'

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const existing = await prisma.campaign.findMany({ where: { useCase: { not: null } }, select: { id: true, useCase: true, name: true, sendingStatus: true, autoPush: true, _count: { select: { leads: true } } } })
  return NextResponse.json(USE_CASE_CAMPAIGNS.map((c) => {
    const e = existing.find((x) => x.useCase === c.key)
    return { key: c.key, name: c.name, useCases: [...c.useCases], id: e?.id || null, sendingStatus: e?.sendingStatus || null, autoPush: e?.autoPush || false, leads: e?._count.leads || 0 }
  }))
}

export async function POST() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ created: await ensureUseCaseCampaigns() })
}
