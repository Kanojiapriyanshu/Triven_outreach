/**
 * Receptionist buyers: business owners who say on YouTube that they miss calls.
 * GET  /api/audience/buyers → tiers, the reply list, buyer videos and what each produced
 * POST /api/audience/buyers
 *   { action: 'search', q, withinDays? }            YouTube search (100 quota units), saved as BUYER-track videos
 *   { action: 'run' }                               read queued videos now, check channels, send Tier A to the Lead Finder
 *   { action: 'reply', id, status, nextStep? }      track a public reply: TODO | SENT | RESPONDED | SKIPPED
 *   { action: 'business', id, website?, businessName?, location? }   you found their business: makes them Tier A
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { searchVideos, YouTubeError } from '@/lib/audience/youtube'
import { saveVideos } from '@/lib/audience/actions'
import { collectComments } from '@/lib/audience/pipeline'
import { buyerOverview, buyerStep, refreshBuyers, promoteBuyers } from '@/lib/audience/buyers'
import { hostOf } from '@/lib/audience/enrich'

export const maxDuration = 60

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await buyerOverview())
}

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('search'), q: z.string().trim().min(3, 'Type what to search for').max(120), withinDays: z.number().int().min(0).max(3650).optional() }),
  z.object({ action: z.literal('run') }),
  z.object({ action: z.literal('reply'), id: z.string(), status: z.enum(['TODO', 'SENT', 'RESPONDED', 'SKIPPED']), nextStep: z.string().trim().max(300).optional() }),
  z.object({
    action: z.literal('business'), id: z.string(),
    website: z.string().trim().max(200).optional(), businessName: z.string().trim().max(120).optional(), location: z.string().trim().max(80).optional(),
  }),
])

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message || 'Invalid request' }, { status: 400 })
  const d = parsed.data

  if (d.action === 'search') {
    try {
      const videos = await searchVideos({
        q: d.q, regionCode: 'US', order: 'relevance',
        publishedAfter: d.withinDays ? new Date(Date.now() - d.withinDays * 86_400_000).toISOString() : undefined,
      })
      const saved = await saveVideos(videos, { track: 'BUYER' })
      saved.sort((a, b) => b.score - a.score)
      return NextResponse.json({ found: videos.length, videos: saved })
    } catch (err) {
      const status = err instanceof YouTubeError && err.reason === 'quotaExceeded' ? 429 : 400
      return NextResponse.json({ error: (err as Error).message }, { status })
    }
  }

  if (d.action === 'run') {
    const deadline = Date.now() + 50_000
    const collect = await collectComments(Date.now() + 30_000)
    const buyers = await buyerStep(deadline)
    const waiting = await prisma.audienceVideo.count({ where: { track: 'BUYER', status: { in: ['QUEUED', 'COLLECTING'] } } })
    return NextResponse.json({ collect, buyers, waiting })
  }

  const buyer = await prisma.buyerProspect.findUnique({ where: { id: d.id } })
  if (!buyer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (d.action === 'reply') {
    await prisma.buyerProspect.update({
      where: { id: buyer.id },
      data: {
        replyStatus: d.status,
        ...(d.status === 'SENT' && !buyer.replySentAt ? { replySentAt: new Date() } : {}),
        ...(d.status === 'TODO' ? { replySentAt: null } : {}),
        ...(d.nextStep !== undefined ? { nextStep: d.nextStep || null } : {}),
      },
    })
    return NextResponse.json({ ok: true })
  }

  // You looked them up (their reply, their channel, a search): record the business and move them to Tier A
  const site = d.website ? (/^https?:\/\//i.test(d.website) ? d.website : `https://${d.website}`) : ''
  if (site && !hostOf(site).includes('.')) return NextResponse.json({ error: 'That doesn\'t look like a website address' }, { status: 400 })
  await prisma.buyerProspect.update({
    where: { id: buyer.id },
    data: {
      ...(site ? { website: `https://${hostOf(site)}` } : {}),
      ...(d.businessName ? { businessName: d.businessName } : {}),
      ...(d.location ? { location: d.location } : {}),
      checkedAt: buyer.checkedAt || new Date(),
    },
  })
  await refreshBuyers([buyer.youtubeChannelId])
  const promote = await promoteBuyers(Date.now() + 20_000)
  return NextResponse.json({ ok: true, promote })
}
