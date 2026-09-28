// Community export connector (PRD R1.4): members and their posts from a community Triven runs
// or has written permission to use, imported from the platform's own export (CSV/JSON).
// Posts go through the same classification as comments; people get evidence, use case and
// fit like everyone else. Emails are only kept when the importer confirms members agreed to
// be contacted. Nothing is ever scraped.
import crypto from 'crypto'
import prisma from '../prisma'
import { ingestComments } from './pipeline'
import { isUsableEmail, normalizeEmail, emailTraits } from './verify'
import { recomputeIntelligence } from './intelligence'

export interface CommunityRow { name: string; profileUrl?: string; post: string; email?: string; website?: string; postedAt?: string }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'community'
const hash = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16)

export async function importCommunity(opts: { community: string; rows: CommunityRow[]; consentToContact: boolean }) {
  const cid = `community:${slug(opts.community)}`
  const channel = await prisma.audienceChannel.upsert({
    where: { youtubeChannelId: cid },
    create: { youtubeChannelId: cid, platform: 'COMMUNITY', title: opts.community, topicScore: 70, description: 'Imported community export' },
    update: {},
  })
  const batchId = `${cid}:${new Date().toISOString().slice(0, 10)}`
  const video = await prisma.audienceVideo.upsert({
    where: { youtubeVideoId: batchId },
    create: { youtubeVideoId: batchId, platform: 'COMMUNITY', channelId: channel.id, title: `${opts.community} export ${new Date().toISOString().slice(0, 10)}`, status: 'DONE', score: 60 },
    update: {},
  })

  const rows = opts.rows.filter((r) => r.name?.trim() && r.post?.trim()).slice(0, 20_000)
  const person = (r: CommunityRow) => `${cid}:${slug(r.profileUrl || r.name)}`
  const result = await ingestComments(
    { id: video.id, title: video.title, platform: 'COMMUNITY', interestCategory: null },
    rows.map((r) => ({
      externalId: `${cid}:${hash(`${person(r)}|${r.post.trim()}`)}`,
      authorExternalId: person(r),
      authorName: r.name.trim().slice(0, 80),
      avatarUrl: null,
      text: r.post.trim().slice(0, 5000),
      likeCount: 0, replyCount: 0, parentId: null,
      publishedAt: r.postedAt && !Number.isNaN(Date.parse(r.postedAt)) ? new Date(r.postedAt) : null,
      handle: r.name.trim(),
      profileUrl: r.profileUrl?.trim() || null,
    })),
  )
  await prisma.audienceVideo.update({ where: { id: video.id }, data: { commentsCollected: { increment: result.inserted }, lastCollectedAt: new Date() } })

  // Profile facts from the export itself (website, and email only with consent)
  let emails = 0
  const touched = new Set<string>()
  for (const r of rows) {
    const p = await prisma.prospect.findUnique({ where: { youtubeChannelId: person(r) }, select: { id: true, website: true } })
    if (!p) continue
    touched.add(p.id)
    if (r.website && !p.website) await prisma.prospect.update({ where: { id: p.id }, data: { website: /^https?:\/\//.test(r.website) ? r.website : `https://${r.website}` } })
    const email = r.email ? normalizeEmail(r.email) : ''
    if (opts.consentToContact && email && isUsableEmail(email)) {
      const exists = await prisma.prospectEmail.findUnique({ where: { email } })
      if (!exists) {
        const t = emailTraits(email)
        await prisma.prospectEmail.create({ data: { prospectId: p.id, email, source: 'MANUAL', sourceUrl: r.profileUrl || null, isFree: t.isFree, isRole: t.isRole } })
        emails++
      }
    }
  }
  await recomputeIntelligence([...touched])
  return { rows: rows.length, newPosts: result.inserted, newPeople: result.newProspects, emails }
}
