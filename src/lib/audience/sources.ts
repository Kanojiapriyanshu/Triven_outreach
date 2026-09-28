// Source intelligence (PRD M9/M10): which channels and videos produce reachable people,
// replies, meetings and revenue — and the yield loop that steers collection toward them.
//   snapshot  — nightly aggregate per channel and per video (our own numbers, kept after purges)
//   yield     — QRA per 1,000 comments, plus a bonus for meetings once there's outcome data
//   allocate  — auto-pause sources that produce nothing; recommend what to collect next
// People counts are "anyone who commented there"; outcomes (contacted → revenue) use first-touch
// attribution so a deal is never counted twice.
import prisma from '../prisma'

interface Row {
  key: string; title: string | null; comments: bigint; flagged: bigint; people: bigint; qualified: bigint; qra: bigint
  contacted: bigint; replied: bigint; positive: bigint; meetings: bigint; won: bigint; revenue: number | null
}

const QRA_SQL = `p."intentScore" >= 60 AND p."fitScore" >= 60 AND p."reachability" >= 80 AND NOT p."inauthentic"`

async function channelRows(): Promise<Row[]> {
  return prisma.$queryRawUnsafe<Row[]>(`
    WITH people AS (
      SELECT ch."youtubeChannelId" AS key, ch.title,
        COUNT(c.id) AS comments,
        COUNT(c.id) FILTER (WHERE c."flaggedInauthentic") AS flagged,
        COUNT(DISTINCT p.id) AS people,
        COUNT(DISTINCT p.id) FILTER (WHERE p.relevance IN ('HIGH','MEDIUM')) AS qualified,
        COUNT(DISTINCT p.id) FILTER (WHERE ${QRA_SQL}) AS qra
      FROM audience_channels ch
      JOIN audience_videos v ON v."channelId" = ch.id
      JOIN audience_comments c ON c."videoId" = v.id
      LEFT JOIN prospects p ON p.id = c."prospectId"
      GROUP BY ch."youtubeChannelId", ch.title
    ), outcomes AS (
      SELECT p."firstContainerId" AS key,
        COUNT(l.id) FILTER (WHERE l."firstEmailSentAt" IS NOT NULL) AS contacted,
        COUNT(l.id) FILTER (WHERE l."hasReplied") AS replied,
        COUNT(l.id) FILTER (WHERE l."isInterested") AS positive,
        COUNT(l.id) FILTER (WHERE l."meetingBooked") AS meetings,
        COUNT(l.id) FILTER (WHERE l."hasSale") AS won,
        COALESCE(SUM(l."dealValue") FILTER (WHERE l."hasSale"), 0)::float AS revenue
      FROM leads l JOIN prospects p ON p.id = l."prospectId"
      WHERE p."firstContainerId" IS NOT NULL
      GROUP BY p."firstContainerId"
    )
    SELECT people.*, COALESCE(o.contacted,0) AS contacted, COALESCE(o.replied,0) AS replied, COALESCE(o.positive,0) AS positive,
      COALESCE(o.meetings,0) AS meetings, COALESCE(o.won,0) AS won, COALESCE(o.revenue,0) AS revenue
    FROM people LEFT JOIN outcomes o ON o.key = people.key`)
}

async function videoRows(): Promise<Array<Row & { channel: string }>> {
  return prisma.$queryRawUnsafe(`
    WITH people AS (
      SELECT v."youtubeVideoId" AS key, v.title, ch."youtubeChannelId" AS channel,
        COUNT(c.id) AS comments,
        COUNT(c.id) FILTER (WHERE c."flaggedInauthentic") AS flagged,
        COUNT(DISTINCT p.id) AS people,
        COUNT(DISTINCT p.id) FILTER (WHERE p.relevance IN ('HIGH','MEDIUM')) AS qualified,
        COUNT(DISTINCT p.id) FILTER (WHERE ${QRA_SQL}) AS qra
      FROM audience_videos v
      JOIN audience_channels ch ON ch.id = v."channelId"
      JOIN audience_comments c ON c."videoId" = v.id
      LEFT JOIN prospects p ON p.id = c."prospectId"
      GROUP BY v."youtubeVideoId", v.title, ch."youtubeChannelId"
    ), outcomes AS (
      SELECT p."firstContentId" AS key,
        COUNT(l.id) FILTER (WHERE l."firstEmailSentAt" IS NOT NULL) AS contacted,
        COUNT(l.id) FILTER (WHERE l."hasReplied") AS replied,
        COUNT(l.id) FILTER (WHERE l."isInterested") AS positive,
        COUNT(l.id) FILTER (WHERE l."meetingBooked") AS meetings,
        COUNT(l.id) FILTER (WHERE l."hasSale") AS won,
        COALESCE(SUM(l."dealValue") FILTER (WHERE l."hasSale"), 0)::float AS revenue
      FROM leads l JOIN prospects p ON p.id = l."prospectId"
      WHERE p."firstContentId" IS NOT NULL
      GROUP BY p."firstContentId"
    )
    SELECT people.*, COALESCE(o.contacted,0) AS contacted, COALESCE(o.replied,0) AS replied, COALESCE(o.positive,0) AS positive,
      COALESCE(o.meetings,0) AS meetings, COALESCE(o.won,0) AS won, COALESCE(o.revenue,0) AS revenue
    FROM people LEFT JOIN outcomes o ON o.key = people.key`)
}

const n = (x: unknown) => Number(x || 0)

/** QRA per 1,000 comments; once 50+ people were contacted, meetings per 100 contacted add to it */
export function yieldOf(r: { comments: number; qra: number; contacted: number; meetings: number }) {
  const base = r.comments ? (r.qra * 1000) / r.comments : 0
  const outcome = r.contacted >= 50 ? (r.meetings * 100) / r.contacted : 0
  return Math.round((base + outcome) * 100) / 100
}

/** Nightly: store today's numbers, refresh yield scores, pause sources that produce nothing */
export async function snapshotSources() {
  const date = new Date(new Date().toISOString().slice(0, 10))
  const [channels, videos, platforms] = await Promise.all([
    channelRows(), videoRows(),
    prisma.audienceChannel.findMany({ select: { youtubeChannelId: true, platform: true } }),
  ])
  const platformOf = new Map(platforms.map((p) => [p.youtubeChannelId, p.platform]))
  const data = (r: Row) => ({
    title: r.title?.slice(0, 200) || null, comments: n(r.comments), flagged: n(r.flagged), people: n(r.people), qualified: n(r.qualified), qra: n(r.qra),
    contacted: n(r.contacted), replied: n(r.replied), positive: n(r.positive), meetings: n(r.meetings), won: n(r.won), revenue: n(r.revenue),
  })
  // Batched: one round trip per 50 rows
  const ops = [
    ...channels.map((r) => prisma.sourceSnapshot.upsert({
      where: { date_containerId_contentId: { date, containerId: r.key, contentId: '' } },
      create: { date, platform: platformOf.get(r.key) || 'YOUTUBE', containerId: r.key, contentId: '', ...data(r) },
      update: data(r),
    })),
    ...videos.map((r) => prisma.sourceSnapshot.upsert({
      where: { date_containerId_contentId: { date, containerId: r.channel, contentId: r.key } },
      create: { date, platform: platformOf.get(r.channel) || 'YOUTUBE', containerId: r.channel, contentId: r.key, ...data(r) },
      update: data(r),
    })),
  ]
  for (let i = 0; i < ops.length; i += 50) await prisma.$transaction(ops.slice(i, i + 50))

  // Yield scores + auto-pause for sources that produce nothing reachable
  let paused = 0
  for (const r of channels) {
    const d = data(r)
    const y = yieldOf(d)
    // Judged on audience quality, not reachability (which also depends on which keys are set):
    // 5,000+ comments with under 0.5% qualified builders and nobody contacted → not our audience
    const pause = d.comments >= 5000 && d.qualified / d.comments < 0.005 && d.contacted === 0
    const res = await prisma.audienceChannel.updateMany({
      where: { youtubeChannelId: r.key, autoPaused: false },
      data: { yieldScore: y, ...(pause ? { autoPaused: true, pausedReason: `Only ${d.qualified} qualified builders in ${d.comments.toLocaleString('en-US')} comments` } : {}) },
    })
    if (!res.count) await prisma.audienceChannel.updateMany({ where: { youtubeChannelId: r.key }, data: { yieldScore: y } })
    if (pause && res.count) paused++
  }
  return { channels: channels.length, videos: videos.length, paused }
}

/** What to collect next: fresh uploads from the best channels, then strong unread content */
export async function recommendations(limit = 12) {
  const since = new Date(Date.now() - 21 * 86_400_000)
  const fresh = await prisma.audienceVideo.findMany({
    where: { status: 'DISCOVERED', publishedAt: { gte: since }, channel: { autoPaused: false } },
    orderBy: [{ channel: { yieldScore: 'desc' } }, { score: 'desc' }], take: limit,
    select: { id: true, title: true, score: true, commentCount: true, publishedAt: true, platform: true, youtubeVideoId: true, url: true, channel: { select: { title: true, yieldScore: true } } },
  })
  const more = fresh.length < limit ? await prisma.audienceVideo.findMany({
    where: { status: 'DISCOVERED', score: { gte: 55 }, id: { notIn: fresh.map((v) => v.id) }, channel: { autoPaused: false } },
    orderBy: [{ channel: { yieldScore: 'desc' } }, { score: 'desc' }], take: limit - fresh.length,
    select: { id: true, title: true, score: true, commentCount: true, publishedAt: true, platform: true, youtubeVideoId: true, url: true, channel: { select: { title: true, yieldScore: true } } },
  }) : []
  return [...fresh.map((v) => ({ ...v, why: 'new upload from a strong source' })), ...more.map((v) => ({ ...v, why: 'high fit, not collected yet' }))]
}
