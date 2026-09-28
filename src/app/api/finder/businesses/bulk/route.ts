/**
 * POST /api/finder/businesses/bulk
 * { action: 'push' | 'research' | 'exclude' | 'restore' | 'delete', ids? | filter?, campaignId?, byNiche? }
 * `filter` is the list's query string: the action applies to every matching business.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { businessWhere } from '@/lib/finder/filters'
import { pushBusinesses, researchBatch, rescore } from '@/lib/finder/pipeline'

export const maxDuration = 60

const schema = z.object({
  action: z.enum(['push', 'research', 'exclude', 'restore', 'delete']),
  ids: z.array(z.string()).optional(),
  filter: z.string().optional(),
  campaignId: z.string().optional(),
  byNiche: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  const { action, filter, campaignId, byNiche } = parsed.data
  let ids = parsed.data.ids || []
  if (!ids.length && filter !== undefined) {
    ids = (await prisma.business.findMany({ where: businessWhere(new URLSearchParams(filter)), select: { id: true }, take: 20_000 })).map((b) => b.id)
  }
  if (!ids.length) return NextResponse.json({ error: 'Nothing selected' }, { status: 400 })

  try {
    switch (action) {
      case 'push':
        if (!campaignId && !byNiche) return NextResponse.json({ error: 'Pick a campaign' }, { status: 400 })
        return NextResponse.json(await pushBusinesses(ids, { campaignId, byNiche }, session.userId))
      case 'research': {
        // Research again from scratch (e.g. after adding a verifier key); what doesn't fit in this call waits for the worker
        await prisma.business.updateMany({ where: { id: { in: ids }, lead: null, status: { notIn: ['DO_NOT_CONTACT', 'EXCLUDED'] } }, data: { enrichedAt: null, enrichAttempts: 0, status: 'NEW' } })
        const r = await researchBatch(Date.now() + 45_000, ids.slice(0, 16))
        return NextResponse.json({ ...r, queued: Math.max(0, ids.length - 16) })
      }
      case 'exclude':
        await prisma.business.updateMany({ where: { id: { in: ids }, lead: null }, data: { status: 'EXCLUDED', excludeReason: 'Excluded by you' } })
        return NextResponse.json({ count: ids.length })
      case 'restore': {
        const rows = await prisma.business.findMany({ where: { id: { in: ids }, status: 'EXCLUDED' }, select: { id: true, enrichedAt: true } })
        for (const b of rows.slice(0, 500)) {
          await prisma.business.update({ where: { id: b.id }, data: { status: b.enrichedAt ? 'NO_EMAIL' : 'NEW', excludeReason: null, isChain: false } })
          await rescore(b.id)
        }
        return NextResponse.json({ count: rows.length })
      }
      case 'delete': {
        const r = await prisma.business.deleteMany({ where: { id: { in: ids }, lead: null } })
        return NextResponse.json({ count: r.count })
      }
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
