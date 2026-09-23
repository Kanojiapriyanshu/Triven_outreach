/**
 * POST /api/audience/prospects/bulk
 * { action, ids? | filter?, campaignId?, byPersona?, relevance? }
 * `filter` is the list's query string: the action applies to every matching prospect.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { prospectWhere } from '@/lib/audience/filters'
import { pushToCampaign, markDoNotContact, forgetProspects } from '@/lib/audience/actions'
import { enrichProspects, identityStep, finderStep, verifyPending, updateStatus } from '@/lib/audience/pipeline'
import { getAudienceSettings } from '@/lib/audience/settings'

export const maxDuration = 60

const schema = z.object({
  action: z.enum(['push', 'enrich', 'verify', 'dnc', 'forget', 'setRelevance']),
  ids: z.array(z.string()).optional(),
  filter: z.string().optional(),
  campaignId: z.string().optional(),
  byPersona: z.boolean().optional(),
  relevance: z.enum(['HIGH', 'MEDIUM', 'LOW', 'SPAM']).optional(),
})

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  const { action, filter, campaignId, byPersona, relevance } = parsed.data

  let ids = parsed.data.ids || []
  if (!ids.length && filter !== undefined) {
    ids = (await prisma.prospect.findMany({ where: prospectWhere(new URLSearchParams(filter)), select: { id: true }, take: 20_000 })).map((p) => p.id)
  }
  if (!ids.length) return NextResponse.json({ error: 'Nothing selected' }, { status: 400 })

  try {
    switch (action) {
      case 'push': {
        if (!campaignId && !byPersona) return NextResponse.json({ error: 'Pick a campaign' }, { status: 400 })
        // Only outreach-ready people are pushed; the rest are reported back with a reason
        return NextResponse.json(await pushToCampaign(ids, { campaignId, byPersona }, session.userId))
      }
      case 'enrich': {
        // Re-research on demand (max 12 per call; the worker handles bigger batches)
        // Full research on demand: deep read → identity search → email finders → verify (max 6 per call)
        const settings = await getAudienceSettings()
        const now = ids.slice(0, 6)
        await prisma.prospect.updateMany({ where: { id: { in: ids }, status: { not: 'DO_NOT_CONTACT' } }, data: { enrichedAt: null, enrichAttempts: 0, webSearchedAt: null, finderCheckedAt: null } })
        const deadline = Date.now() + 52_000
        const r = await enrichProspects(Math.min(deadline, Date.now() + 25_000), settings, now)
        const id = await identityStep(Math.min(deadline, Date.now() + 15_000), settings, now)
        const fi = await finderStep(Math.min(deadline, Date.now() + 12_000), settings, now)
        const ve = await verifyPending(deadline, now)
        return NextResponse.json({ ...r, emailsFound: r.emailsFound + id.emailsFound + fi.found, websites: id.websites, linkedIn: id.linkedIn, finderFound: fi.found, verified: ve.verified, queued: Math.max(0, ids.length - now.length) })
      }
      case 'verify':
        return NextResponse.json(await verifyPending(Date.now() + 50_000, ids))
      case 'dnc':
        return NextResponse.json({ count: await markDoNotContact(ids) })
      case 'forget':
        return NextResponse.json({ count: await forgetProspects(ids) })
      case 'setRelevance': {
        if (!relevance) return NextResponse.json({ error: 'Pick a relevance' }, { status: 400 })
        // A human call is final: stamp aiCheckedAt so neither the rules nor the AI override it
        const score = relevance === 'HIGH' ? 80 : relevance === 'MEDIUM' ? 50 : relevance === 'LOW' ? 15 : 0
        const r = await prisma.prospect.updateMany({ where: { id: { in: ids } }, data: { relevance, score, aiCheckedAt: new Date() } })
        for (const id of ids.slice(0, 200)) await updateStatus(id)
        return NextResponse.json({ count: r.count })
      }
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
