// Data quality (PRD M2): comments that look coordinated or incentivised carry no weight.
//   early swarm  — the same accounts commenting within minutes of publishing, on many videos
//   duplicates   — near-identical wording posted by several different accounts
//   reply rings  — the same pairs of accounts replying to each other on several videos
// People whose activity is mostly flagged are marked inauthentic and never contacted.
// Plus a permanent exclusion list (channels, names, domains, emails).
import prisma from '../prisma'

const EARLY_MIN = 15          // minutes after publishing that count as "early"
const SWARM_VIDEOS = 3        // early on this many different videos = swarm member
const DUP_AUTHORS = 3         // same text by this many accounts = template
const RING_VIDEOS = 3         // same pair replying on this many videos = ring

function normal(text: string) {
  return text.toLowerCase().replace(/https?:\S+/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

/** Flag coordinated comments across recently collected videos; returns counts */
export async function detectCoordination(sinceDays = 30) {
  const since = new Date(Date.now() - sinceDays * 86_400_000)
  const comments = await prisma.audienceComment.findMany({
    where: { createdAt: { gte: since }, relevance: { not: 'SPAM' } },
    select: { id: true, authorChannelId: true, text: true, publishedAt: true, parentCommentId: true, youtubeCommentId: true, flaggedInauthentic: true, video: { select: { id: true, publishedAt: true } } },
    take: 50_000,
  })
  const flags = new Map<string, string>()

  // 1. Early swarm
  const earlyVideos = new Map<string, Set<string>>()
  for (const c of comments) {
    if (!c.authorChannelId || !c.publishedAt || !c.video.publishedAt) continue
    const mins = (c.publishedAt.getTime() - c.video.publishedAt.getTime()) / 60_000
    if (mins >= 0 && mins <= EARLY_MIN) {
      const set = earlyVideos.get(c.authorChannelId) || new Set()
      set.add(c.video.id)
      earlyVideos.set(c.authorChannelId, set)
    }
  }
  const swarm = new Set([...earlyVideos].filter(([, v]) => v.size >= SWARM_VIDEOS).map(([a]) => a))
  for (const c of comments) if (c.authorChannelId && swarm.has(c.authorChannelId)) flags.set(c.id, `early on ${earlyVideos.get(c.authorChannelId)!.size} videos`)

  // 2. Same wording from several accounts
  const byText = new Map<string, { authors: Set<string>; ids: string[] }>()
  for (const c of comments) {
    const t = normal(c.text)
    if (t.length < 25 || !c.authorChannelId) continue
    const g = byText.get(t) || { authors: new Set(), ids: [] }
    g.authors.add(c.authorChannelId); g.ids.push(c.id)
    byText.set(t, g)
  }
  for (const g of byText.values()) if (g.authors.size >= DUP_AUTHORS) for (const id of g.ids) flags.set(id, `same text from ${g.authors.size} accounts`)

  // 3. Reply rings: author → parent author pairs across videos
  const authorOf = new Map(comments.map((c) => [c.youtubeCommentId, c.authorChannelId]))
  const pairs = new Map<string, { videos: Set<string>; ids: string[] }>()
  for (const c of comments) {
    if (!c.parentCommentId || !c.authorChannelId) continue
    const parentAuthor = authorOf.get(c.parentCommentId)
    if (!parentAuthor || parentAuthor === c.authorChannelId) continue
    const key = [c.authorChannelId, parentAuthor].sort().join('|')
    const g = pairs.get(key) || { videos: new Set(), ids: [] }
    g.videos.add(c.video.id); g.ids.push(c.id)
    pairs.set(key, g)
  }
  for (const g of pairs.values()) if (g.videos.size >= RING_VIDEOS) for (const id of g.ids) flags.set(id, `reply ring on ${g.videos.size} videos`)

  // Write changes only
  const newly = comments.filter((c) => flags.has(c.id) && !c.flaggedInauthentic)
  for (const c of newly) await prisma.audienceComment.update({ where: { id: c.id }, data: { flaggedInauthentic: true, flagReason: flags.get(c.id) } })
  const people = await markInauthenticPeople()
  await updateChannelQuality()
  return { checked: comments.length, flagged: newly.length, swarmAccounts: swarm.size, people }
}

/** A person is inauthentic when at least 2 comments and ≥ 60% of them are flagged */
export async function markInauthenticPeople() {
  const rows = await prisma.audienceComment.groupBy({ by: ['prospectId', 'flaggedInauthentic'], where: { prospectId: { not: null } }, _count: true })
  const tally = new Map<string, { f: number; t: number }>()
  for (const r of rows) {
    const t = tally.get(r.prospectId!) || { f: 0, t: 0 }
    t.t += r._count; if (r.flaggedInauthentic) t.f += r._count
    tally.set(r.prospectId!, t)
  }
  const bad = [...tally].filter(([, t]) => t.f >= 2 && t.f / t.t >= 0.6).map(([id]) => id)
  if (!bad.length) return 0
  const r = await prisma.prospect.updateMany({ where: { id: { in: bad }, inauthentic: false, lead: null }, data: { inauthentic: true, discoveryStage: 'SUSPECTED_INAUTHENTIC' } })
  return r.count
}

/** Share of each channel's comments that are flagged (Audience Sources shows it; yield uses it) */
export async function updateChannelQuality() {
  const rows = await prisma.$queryRaw<Array<{ channelId: string; total: bigint; flagged: bigint }>>`
    SELECT v."channelId" AS "channelId", COUNT(*) AS total, COUNT(*) FILTER (WHERE c."flaggedInauthentic") AS flagged
    FROM audience_comments c JOIN audience_videos v ON v.id = c."videoId"
    GROUP BY v."channelId"`
  for (const r of rows) {
    const share = Number(r.total) ? Number(r.flagged) / Number(r.total) : 0
    await prisma.audienceChannel.update({ where: { id: r.channelId }, data: { qualityFlagged: Math.round(share * 1000) / 1000 } }).catch(() => null)
  }
}

// ─── Exclusions ──────────────────────────────────────────────────────────────

export interface Exclusions { channels: Set<string>; names: RegExp | null; domains: Set<string>; emails: Set<string> }

export async function loadExclusions(): Promise<Exclusions> {
  const rows = await prisma.exclusionEntry.findMany()
  const names = rows.filter((r) => r.kind === 'NAME').map((r) => r.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return {
    channels: new Set(rows.filter((r) => r.kind === 'CHANNEL').map((r) => r.value)),
    names: names.length ? new RegExp(`^(${names.join('|')})$`, 'i') : null,
    domains: new Set(rows.filter((r) => r.kind === 'DOMAIN').map((r) => r.value.toLowerCase())),
    emails: new Set(rows.filter((r) => r.kind === 'EMAIL').map((r) => r.value.toLowerCase())),
  }
}

export function isExcluded(x: Exclusions, a: { channelId?: string | null; name?: string | null; email?: string | null; website?: string | null }) {
  if (a.channelId && (x.channels.has(a.channelId) || x.channels.has(a.channelId.replace(/^(hn|devto):/, '')))) return true
  if (a.name && x.names?.test(a.name.replace(/^@/, '').trim())) return true
  const email = a.email?.toLowerCase()
  if (email && (x.emails.has(email) || x.domains.has(email.split('@')[1]))) return true
  const site = a.website?.replace(/^https?:\/\/(www\.)?/, '').split('/')[0].toLowerCase()
  return !!site && x.domains.has(site)
}
