/**
 * GET  /api/audience/sources            → channels ranked by yield, full funnel to revenue, recommendations
 * GET  /api/audience/sources?channel=ID → one channel: its videos + who its audience is
 * POST /api/audience/sources { action: 'snapshot' | 'pause' | 'resume' | 'queue', channelId?, videoIds? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { snapshotSources, recommendations, yieldOf } from '@/lib/audience/sources'
import { queueVideos } from '@/lib/audience/actions'

export const maxDuration = 60

async function latestDate() {
  return (await prisma.sourceSnapshot.findFirst({ orderBy: { date: 'desc' }, select: { date: true } }))?.date || null
}

export async function GET(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const channelDbId = new URL(req.url).searchParams.get('channel')
  let date = await latestDate()
  if (!date) { await snapshotSources(); date = await latestDate() }
  if (!date) return NextResponse.json({ channels: [], recommendations: [], date: null })

  if (channelDbId) {
    const ch = await prisma.audienceChannel.findUnique({ where: { id: channelDbId } })
    if (!ch) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const [videos, people] = await Promise.all([
      prisma.sourceSnapshot.findMany({ where: { date, containerId: ch.youtubeChannelId, contentId: { not: '' } }, orderBy: [{ qra: 'desc' }, { qualified: 'desc' }] }),
      prisma.prospect.findMany({
        where: { relevance: { in: ['HIGH', 'MEDIUM'] }, comments: { some: { video: { channelId: ch.id } } } },
        select: { persona: true, useCase: true, country: true }, take: 5000,
      }),
    ])
    const mix = (k: 'persona' | 'useCase' | 'country') => Object.entries(people.reduce<Record<string, number>>((a, p) => { const v = p[k] || 'UNKNOWN'; a[v] = (a[v] || 0) + 1; return a }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8)
    const meta = new Map((await prisma.audienceVideo.findMany({ where: { youtubeVideoId: { in: videos.map((v) => v.contentId) } }, select: { id: true, youtubeVideoId: true, url: true, platform: true, publishedAt: true } })).map((v) => [v.youtubeVideoId, v]))
    return NextResponse.json({
      channel: ch,
      videos: videos.map((v) => ({ ...v, yield: yieldOf(v), meta: meta.get(v.contentId) || null })),
      mix: { persona: mix('persona'), useCase: mix('useCase'), country: mix('country') },
    })
  }

  const [rows, channels, recs, history] = await Promise.all([
    prisma.sourceSnapshot.findMany({ where: { date, contentId: '' } }),
    prisma.audienceChannel.findMany({ select: { id: true, youtubeChannelId: true, title: true, thumbnailUrl: true, platform: true, subscriberCount: true, yieldScore: true, autoPaused: true, pausedReason: true, qualityFlagged: true, isTracked: true, lastScannedAt: true } }),
    recommendations(),
    // QRA trend: the same channels 7 and 30 days ago
    prisma.sourceSnapshot.findMany({ where: { contentId: '', date: { in: [new Date(date.getTime() - 7 * 86_400_000), new Date(date.getTime() - 30 * 86_400_000)] } }, select: { date: true, containerId: true, qra: true } }),
  ])
  const byKey = new Map(channels.map((c) => [c.youtubeChannelId, c]))
  const past = (key: string, days: number) => history.find((h) => h.containerId === key && h.date.getTime() === date!.getTime() - days * 86_400_000)?.qra ?? null
  const out = rows.map((r) => ({ ...r, yield: yieldOf(r), channel: byKey.get(r.containerId) || null, qra7: past(r.containerId, 7), qra30: past(r.containerId, 30) }))
    .filter((r) => r.channel).sort((a, b) => b.yield - a.yield || b.qualified - a.qualified)
  const totals = out.reduce((t, r) => ({ comments: t.comments + r.comments, people: t.people + r.people, qualified: t.qualified + r.qualified, qra: t.qra + r.qra, contacted: t.contacted + r.contacted, replied: t.replied + r.replied, meetings: t.meetings + r.meetings, won: t.won + r.won, revenue: t.revenue + r.revenue }),
    { comments: 0, people: 0, qualified: 0, qra: 0, contacted: 0, replied: 0, meetings: 0, won: 0, revenue: 0 })
  return NextResponse.json({ date, channels: out, totals, recommendations: recs })
}

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { action, channelId, videoIds } = await req.json().catch(() => ({})) as { action?: string; channelId?: string; videoIds?: string[] }
  if (action === 'snapshot') return NextResponse.json(await snapshotSources())
  if (action === 'queue' && videoIds?.length) return NextResponse.json({ queued: await queueVideos(videoIds) })
  if ((action === 'pause' || action === 'resume') && channelId) {
    await prisma.audienceChannel.update({ where: { id: channelId }, data: action === 'pause' ? { autoPaused: true, pausedReason: 'Paused by you' } : { autoPaused: false, pausedReason: null } })
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
