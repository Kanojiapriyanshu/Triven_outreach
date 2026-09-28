// Keeps collection running without anyone clicking "Collect" (PRD R1.2, R1.3):
//   autoQueue  — when the queue runs low, queue the best content already discovered
//   scanTracked — once a day, look for new uploads on tracked channels (best yield first)
//   fastLane   — fresh uploads from top sources are re-read daily for 14 days,
//                so people are contacted while their comment is still recent
import prisma from '../prisma'
import { queueVideos, scanChannel } from './actions'
import { quotaUsage, youtubeConfigured } from './youtube'

const left = (deadline: number) => deadline - Date.now()
const DAY = 86_400_000

export async function autoQueue(minScore = 55) {
  const active = await prisma.audienceVideo.count({ where: { status: { in: ['QUEUED', 'COLLECTING'] } } })
  if (active >= 3) return 0
  const platforms = [...(youtubeConfigured() ? ['YOUTUBE'] : []), 'HN', 'DEVTO']
  const next = await prisma.audienceVideo.findMany({
    where: { status: 'DISCOVERED', score: { gte: minScore }, platform: { in: platforms }, channel: { autoPaused: false } },
    orderBy: [{ channel: { yieldScore: 'desc' } }, { score: 'desc' }, { commentCount: 'desc' }],
    take: 5 - active,
    select: { id: true },
  })
  if (next.length) await queueVideos(next.map((v) => v.id))
  return next.length
}

/** New uploads of tracked YouTube channels, top yield first; ~2 quota units per channel */
export async function scanTracked(deadline: number, maxChannels = 12) {
  const out = { scanned: 0, queued: 0, errors: [] as string[] }
  if (!youtubeConfigured() || (await quotaUsage()).left < 2_000) return out
  const channels = await prisma.audienceChannel.findMany({
    where: { platform: 'YOUTUBE', isTracked: true, autoPaused: false, OR: [{ lastScannedAt: null }, { lastScannedAt: { lt: new Date(Date.now() - DAY) } }] },
    orderBy: [{ yieldScore: 'desc' }, { topicScore: 'desc' }],
    take: maxChannels,
    select: { id: true, title: true, yieldScore: true },
  })
  for (const c of channels) {
    if (left(deadline) < 8_000) break
    try {
      const videos = await scanChannel(c.id, 8)
      out.scanned++
      const fresh = videos.filter((v) => v.status === 'DISCOVERED' && v.score >= 50 && v.publishedAt && Date.now() - v.publishedAt.getTime() < 14 * DAY)
      if (fresh.length) {
        await queueVideos(fresh.map((v) => v.id))
        await prisma.audienceVideo.updateMany({ where: { id: { in: fresh.map((v) => v.id) } }, data: { fastLaneUntil: new Date(Math.max(...fresh.map((v) => v.publishedAt!.getTime())) + 14 * DAY) } })
        out.queued += fresh.length
      }
    } catch (err) {
      out.errors.push(`${c.title}: ${(err as Error).message}`)
      if (/quota/i.test((err as Error).message)) break
    }
  }
  return out
}

/** Re-read fresh fast-lane videos once a day (new comments only; dedupe makes it safe) */
export async function fastLane() {
  const due = await prisma.audienceVideo.findMany({
    where: { fastLaneUntil: { gt: new Date() }, status: 'DONE', OR: [{ lastCollectedAt: null }, { lastCollectedAt: { lt: new Date(Date.now() - 20 * 3_600_000) } }] },
    select: { id: true },
    take: 10,
  })
  if (due.length) await queueVideos(due.map((v) => v.id), 300)
  return due.length
}
