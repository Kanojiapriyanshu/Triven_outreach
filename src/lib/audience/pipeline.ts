// The audience pipeline. Every step works in small batches against a deadline, so it runs
// inside a 60 s serverless call and simply continues on the next worker tick.
//
//   collect  → YouTube comments (deduped by comment id) → rule classification → prospects
//              with an INTENT score (evidence they build/buy) and an IDENTITY score
//   review   → optional AI pass over the shortlisted prospects
//   enrich   → deep read via the API (bio, their uploads + descriptions), links, own website
//   identity → web-search API finds site / LinkedIn for high-intent people YouTube didn't reveal
//   finder   → Hunter / Apollo business email once identity is known
//   verify   → MX / verifier → VERIFIED | RISKY | UNKNOWN | INVALID
//   status   → READY_TO_CONTACT when intent, identity, business email and country rules all pass
import type { Prisma, Prospect, ProspectEmail } from '@prisma/client'
import prisma from '../prisma'
import { classifyComment, parseName, profileHints, computeIntent, computeIdentity, ownChannelProfile } from './classify'
import { commentThreadsPage, getChannels, getVideos, latestUploadIds, YouTubeError, youtubeConfigured, type YtComment } from './youtube'
import { discover, hostOf, patternGuesses, SHARED_HOSTS, crawlWebsite, type Findings } from './enrich'
import { resolveIdentity, searchProvider } from './identity'
import { findBusinessEmail, finderProviders } from './finders'
import { hunterAccount, hunterConfigured, hunterEnrich, HunterLimitError } from './hunter'
import { emailTraits, verifierProvider, verifyEmail, FREE_MAIL } from './verify'
import { aiConfigured, reviewProspects, describeAiError } from './ai'
import { CONSENT_SENSITIVE, regionOf } from './taxonomy'
import { getAudienceSettings, type AudienceSettings } from './settings'

const left = (deadline: number) => deadline - Date.now()

// ─── 1. Collect ──────────────────────────────────────────────────────────────

export interface CollectResult { pages: number; newComments: number; newProspects: number; videosDone: number; errors: string[] }

export async function collectComments(deadline: number): Promise<CollectResult> {
  const out: CollectResult = { pages: 0, newComments: 0, newProspects: 0, videosDone: 0, errors: [] }
  if (!youtubeConfigured()) return out
  const videos = await prisma.audienceVideo.findMany({
    where: { status: { in: ['QUEUED', 'COLLECTING'] } },
    include: { channel: { select: { youtubeChannelId: true } } },
    orderBy: [{ status: 'asc' }, { score: 'desc' }], // COLLECTING first, then best-fit
    take: 10,
  })

  for (const video of videos) {
    while (left(deadline) > 8_000) {
      let page
      try {
        page = await commentThreadsPage(video.youtubeVideoId, video.nextPageToken)
      } catch (err) {
        const e = err as YouTubeError
        if (e.reason === 'quotaExceeded' || e.reason === 'noKey') { out.errors.push(e.message); return out }
        const disabled = e.reason === 'commentsDisabled'
        await prisma.audienceVideo.update({
          where: { id: video.id },
          data: { status: disabled ? 'SKIPPED' : 'ERROR', lastError: disabled ? 'Comments are turned off on this video' : e.message.slice(0, 300) },
        })
        if (!disabled) out.errors.push(`${video.title}: ${e.message}`)
        break
      }
      out.pages++
      const { inserted, newProspects } = await ingestThreads(video, page.items.flatMap((t) => [t.snippet.topLevelComment, ...(t.replies?.comments || [])])
        .map((c) => ({ c, isReply: !!c.snippet.parentId })), page.items)
      out.newComments += inserted
      out.newProspects += newProspects

      video.commentsCollected += inserted
      video.nextPageToken = page.nextPageToken || null
      const done = !page.nextPageToken || video.commentsCollected >= video.maxComments
      await prisma.audienceVideo.update({
        where: { id: video.id },
        data: {
          commentsCollected: video.commentsCollected,
          nextPageToken: done ? null : page.nextPageToken,
          status: done ? 'DONE' : 'COLLECTING',
          lastCollectedAt: new Date(),
          lastError: null,
        },
      })
      if (done) { out.videosDone++; break }
    }
    if (left(deadline) <= 8_000) break
  }
  return out
}

async function ingestThreads(
  video: { id: string; title: string; interestCategory: string | null; channel: { youtubeChannelId: string } },
  comments: Array<{ c: YtComment; isReply: boolean }>,
  threads: Array<{ id: string; snippet: { totalReplyCount?: number } }>,
) {
  const replyCounts = new Map(threads.map((t) => [t.id, t.snippet.totalReplyCount || 0]))
  // The creator's own replies aren't prospects; neither are authors without a channel
  const usable = comments.filter(({ c }) => c.snippet.authorChannelId?.value && c.snippet.authorChannelId.value !== video.channel.youtubeChannelId)
  if (!usable.length) return { inserted: 0, newProspects: 0 }

  const known = await prisma.audienceComment.findMany({ where: { youtubeCommentId: { in: usable.map(({ c }) => c.id) } }, select: { youtubeCommentId: true } })
  const seen = new Set(known.map((k) => k.youtubeCommentId))
  const fresh = usable.filter(({ c }) => !seen.has(c.id))
  if (!fresh.length) return { inserted: 0, newProspects: 0 }

  // Prospects: one per commenter channel, however many comments they left
  const authors = new Map<string, YtComment>()
  for (const { c } of fresh) authors.set(c.snippet.authorChannelId!.value, c)
  const existing = await prisma.prospect.findMany({ where: { youtubeChannelId: { in: [...authors.keys()] } }, select: { id: true, youtubeChannelId: true } })
  const have = new Set(existing.map((p) => p.youtubeChannelId))
  const toCreate = [...authors.entries()].filter(([id]) => !have.has(id)).map(([id, c]) => {
    const display = c.snippet.authorDisplayName || 'Unknown'
    const name = parseName(display)
    return {
      youtubeChannelId: id,
      displayName: display.replace(/^@/, ''),
      handle: display.startsWith('@') ? display : null,
      avatarUrl: c.snippet.authorProfileImageUrl || null,
      firstName: name.firstName || null,
      lastName: name.lastName || null,
    }
  })
  const created = toCreate.length ? await prisma.prospect.createMany({ data: toCreate, skipDuplicates: true }) : { count: 0 }
  const all = await prisma.prospect.findMany({ where: { youtubeChannelId: { in: [...authors.keys()] } }, select: { id: true, youtubeChannelId: true } })
  const idOf = new Map(all.map((p) => [p.youtubeChannelId, p.id]))

  const rows: Prisma.AudienceCommentCreateManyInput[] = fresh.map(({ c, isReply }) => {
    const text = c.snippet.textOriginal || c.snippet.textDisplay || ''
    const v = classifyComment(text, { likeCount: c.snippet.likeCount, videoInterest: video.interestCategory, authorName: c.snippet.authorDisplayName })
    return {
      youtubeCommentId: c.id,
      videoId: video.id,
      prospectId: idOf.get(c.snippet.authorChannelId!.value) || null,
      authorChannelId: c.snippet.authorChannelId!.value,
      authorName: c.snippet.authorDisplayName || 'Unknown',
      text: text.slice(0, 5000),
      likeCount: c.snippet.likeCount || 0,
      replyCount: replyCounts.get(c.id) || 0,
      isReply,
      parentCommentId: c.snippet.parentId || null,
      publishedAt: c.snippet.publishedAt ? new Date(c.snippet.publishedAt) : null,
      language: v.language,
      relevance: v.relevance,
      score: v.score,
      persona: v.persona,
      interestCategory: v.interest,
      topic: v.topic,
      signals: v.signals,
    }
  })
  const inserted = await prisma.audienceComment.createMany({ data: rows, skipDuplicates: true })
  await refreshProspects([...new Set(rows.map((r) => r.prospectId).filter(Boolean) as string[])])
  return { inserted: inserted.count, newProspects: created.count }
}

// ─── Prospect roll-up ────────────────────────────────────────────────────────

const RANK: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, SPAM: 0 }

/** Recompute a prospect's score/relevance/persona/topic/reason from all of their comments */
export async function refreshProspects(ids: string[]) {
  if (!ids.length) return
  const [prospects, comments] = await Promise.all([
    prisma.prospect.findMany({ where: { id: { in: ids } } }),
    prisma.audienceComment.findMany({
      where: { prospectId: { in: ids } },
      select: { id: true, prospectId: true, score: true, relevance: true, persona: true, interestCategory: true, topic: true, signals: true, text: true, video: { select: { title: true, channel: { select: { title: true } } } } },
      orderBy: { score: 'desc' },
    }),
  ])
  const byProspect = new Map<string, typeof comments>()
  for (const c of comments) {
    const list = byProspect.get(c.prospectId!) || []
    list.push(c)
    byProspect.set(c.prospectId!, list)
  }

  const updates = prospects.map((p) => {
    const list = byProspect.get(p.id) || []
    const best = list[0]
    if (!best) return null
    const nonSpam = list.filter((c) => c.relevance !== 'SPAM')
    const bio = profileHints(p.channelDescription || p.bio || '')
    const { intent, relevance, evidence } = computeIntent({
      comments: list.map((c) => ({ score: c.score, signals: c.signals, relevance: c.relevance, channel: c.video.channel.title, video: c.video.title })),
      bioPersona: bio.persona,
      bioTitle: p.jobTitle || bio.jobTitle,
      ownChannelAi: p.ownChannelAi,
      ownChannelSummary: p.ownChannelSummary,
      hasWebsite: !!p.website,
    })
    const identity = computeIdentity(p)
    const videos = [...new Set(nonSpam.map((c) => c.video.title))]
    const reason = nonSpam.length
      ? `${evidence.slice(0, 3).join('; ') || 'Engaged comment'} · on ${videos.length === 1 ? `"${videos[0].slice(0, 70)}" (${best.video.channel.title})` : `${videos.length} videos`}`
      : 'Only spam comments'

    // Counts, intent and identity always refresh; an AI or human verdict wins for relevance/persona/topic
    const data: Prisma.ProspectUpdateInput = {
      commentCount: list.length, lastSeenAt: new Date(), bestCommentId: best.id,
      intentScore: intent, intentEvidence: evidence, identityScore: identity, score: intent,
    }
    if (!p.aiCheckedAt) {
      Object.assign(data, {
        relevance,
        persona: best.persona || bio.persona || nonSpam.find((c) => c.persona)?.persona || null,
        interestCategory: best.interestCategory || nonSpam.find((c) => c.interestCategory)?.interestCategory || null,
        topic: best.topic || nonSpam.find((c) => c.topic)?.topic || null,
        reason,
      })
    }
    return prisma.prospect.update({ where: { id: p.id }, data })
  }).filter(Boolean) as Prisma.PrismaPromise<Prospect>[]

  for (let i = 0; i < updates.length; i += 25) await prisma.$transaction(updates.slice(i, i + 25))
}

// ─── 2. AI review ────────────────────────────────────────────────────────────

export async function aiReview(deadline: number, settings: AudienceSettings) {
  const out = { reviewed: 0, error: '' }
  if (!aiConfigured() || !settings.useAi) return out
  while (left(deadline) > 25_000) {
    const batch = await prisma.prospect.findMany({
      where: { aiCheckedAt: null, relevance: { not: 'SPAM' }, score: { gte: 25 }, status: { not: 'DO_NOT_CONTACT' } },
      orderBy: { score: 'desc' },
      take: 15,
      select: {
        id: true, displayName: true, channelDescription: true, intentEvidence: true, ownChannelSummary: true,
        comments: { orderBy: { score: 'desc' }, take: 4, select: { text: true, video: { select: { title: true } } } },
      },
    })
    if (!batch.length) break
    let results
    try {
      results = await reviewProspects(batch.map((p) => ({
        id: p.id, name: p.displayName,
        bio: [p.channelDescription, p.ownChannelSummary && `Their channel: ${p.ownChannelSummary}`, p.intentEvidence.length && `Signals: ${p.intentEvidence.join('; ')}`].filter(Boolean).join('\n'),
        comments: p.comments.map((c) => ({ video: c.video.title, text: c.text })),
      })))
    } catch (err) {
      out.error = describeAiError(err)
      break
    }
    const now = new Date()
    const byId = new Map(results.map((r) => [r.id, r]))
    await prisma.$transaction(batch.map((p) => {
      const r = byId.get(p.id)
      // A person the AI skipped still gets stamped so we don't pay for them twice
      if (!r) return prisma.prospect.update({ where: { id: p.id }, data: { aiCheckedAt: now } })
      return prisma.prospect.update({
        where: { id: p.id },
        data: {
          aiCheckedAt: now,
          relevance: r.relevance,
          persona: r.persona,
          interestCategory: r.interest,
          topic: r.topic.trim().replace(/[.]+$/, '') || null,
          icebreaker: r.icebreaker.trim() || null,
          reason: `AI: ${r.reason}`,
        },
      })
    }))
    out.reviewed += batch.length
  }
  return out
}

// ─── 3. Enrich ───────────────────────────────────────────────────────────────

export async function enrichProspects(deadline: number, settings: AudienceSettings, onlyIds?: string[]) {
  const out = { enriched: 0, emailsFound: 0, errors: [] as string[] }
  const relevance = settings.enrichFrom === 'HIGH' ? ['HIGH'] : ['HIGH', 'MEDIUM']
  const batch = await prisma.prospect.findMany({
    where: onlyIds
      ? { id: { in: onlyIds }, status: { not: 'DO_NOT_CONTACT' } }
      : { enrichedAt: null, relevance: { in: relevance }, status: { notIn: ['DO_NOT_CONTACT', 'IN_CAMPAIGN'] }, enrichAttempts: { lt: 3 } },
    orderBy: { score: 'desc' },
    take: onlyIds ? onlyIds.length : 12,
    include: { comments: { select: { text: true }, orderBy: { score: 'desc' }, take: 10 } },
  })
  if (!batch.length) return out

  // Deep read through the API: channel bios for the whole batch in one 1-unit call, then for
  // people who upload, their latest videos (1 unit each) and those videos' descriptions (1 unit/50).
  // Creators list "business inquiries" addresses and their sites there.
  const own = new Map<string, OwnVideos>()
  if (youtubeConfigured()) {
    try {
      const channels = await getChannels(batch.map((p) => p.youtubeChannelId))
      const byId = new Map(channels.map((c) => [c.id, c]))
      const uploads: Array<{ prospectId: string; playlist: string }> = []
      for (const p of batch) {
        const c = byId.get(p.youtubeChannelId)
        if (!c) continue
        p.channelDescription = c.snippet.description || null
        p.subscriberCount = Number(c.statistics?.subscriberCount || 0)
        p.videoCount = Number(c.statistics?.videoCount || 0)
        p.country = c.snippet.country || p.country
        p.handle = c.snippet.customUrl || p.handle
        const playlist = c.contentDetails?.relatedPlaylists?.uploads
        if (p.videoCount > 0 && playlist) uploads.push({ prospectId: p.id, playlist })
      }
      const idsByProspect = new Map<string, string[]>()
      for (const u of uploads) {
        if (left(deadline) < 20_000) break
        try { idsByProspect.set(u.prospectId, await latestUploadIds(u.playlist, 8)) } catch { /* private/removed playlist */ }
      }
      const videos = await getVideos([...idsByProspect.values()].flat())
      const byVideo = new Map(videos.map((v) => [v.id, v]))
      for (const [prospectId, ids] of idsByProspect) {
        const vs = ids.map((id) => byVideo.get(id)).filter(Boolean) as typeof videos
        own.set(prospectId, { videos: vs.map((v) => ({ id: v.id, text: `${v.snippet.title}\n${v.snippet.description}` })), titles: vs.map((v) => v.snippet.title) })
      }
    } catch (err) {
      out.errors.push((err as Error).message)
    }
  }
  await prisma.prospect.updateMany({ where: { id: { in: batch.map((p) => p.id) } }, data: { status: 'RESEARCHING', enrichAttempts: { increment: 1 } } })

  // A few at a time: websites are slow, and each gets its own time budget
  const queue = [...batch]
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      if (left(deadline) < 15_000) return
      try {
        out.emailsFound += await enrichOne(p, Math.min(deadline, Date.now() + 25_000), own.get(p.id))
        out.enriched++
      } catch (err) {
        out.errors.push(`${p.displayName}: ${(err as Error).message}`)
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  // Anything not reached goes back in line
  const stuck = queue.map((p) => p.id)
  if (stuck.length) await prisma.prospect.updateMany({ where: { id: { in: stuck } }, data: { status: 'NEW', enrichAttempts: { decrement: 1 } } })
  return out
}

interface OwnVideos { videos: Array<{ id: string; text: string }>; titles: string[] }

async function enrichOne(p: Prospect & { comments: Array<{ text: string }> }, deadline: number, ownVideos?: OwnVideos) {
  const f = await discover({ bio: p.channelDescription || '', comments: p.comments.map((c) => c.text), ownVideos: ownVideos?.videos, deadline })
  const channelProfile = ownChannelProfile(ownVideos?.titles || [])

  let { firstName, lastName } = p
  if (!firstName && f.fullName) {
    const n = parseName(f.fullName)
    firstName = n.firstName || null
    lastName = n.lastName || null
  }
  const country = (p.country || f.country || null)?.toUpperCase() || null

  // Guessed addresses only when a verifier can confirm them, on a domain the person owns
  const domain = f.website ? hostOf(f.website) : ''
  if (verifierProvider() && firstName && domain && !SHARED_HOSTS.test(domain) && !FREE_MAIL.has(domain) && !f.emails.some((e) => e.email.endsWith(`@${domain}`))) {
    for (const email of patternGuesses(firstName, lastName || undefined, domain).slice(0, 3)) f.emails.push({ email, source: 'PATTERN', sourceUrl: f.website })
  }

  // An address belongs to one person: skip any already attached to someone else
  const taken = new Set((await prisma.prospectEmail.findMany({ where: { email: { in: f.emails.map((e) => e.email) } }, select: { email: true } })).map((e) => e.email))
  const newEmails = f.emails.filter((e) => !taken.has(e.email))
  if (newEmails.length) {
    await prisma.prospectEmail.createMany({
      data: newEmails.map((e) => ({ prospectId: p.id, email: e.email, source: e.source, sourceUrl: e.sourceUrl || null, ...pick(emailTraits(e.email), ['isFree', 'isRole']) })),
      skipDuplicates: true,
    })
  }

  await prisma.prospect.update({
    where: { id: p.id },
    data: {
      channelDescription: p.channelDescription,
      subscriberCount: p.subscriberCount,
      videoCount: p.videoCount,
      handle: p.handle,
      firstName, lastName,
      country,
      region: regionOf(country),
      consentSensitive: !!country && CONSENT_SENSITIVE.has(country),
      website: p.website || f.website || null,
      linkedIn: p.linkedIn || f.linkedIn || null,
      twitter: p.twitter || f.twitter || null,
      github: p.github || f.github || null,
      otherLinks: [...new Set([...p.otherLinks, ...f.otherLinks])].slice(0, 15),
      company: p.company || f.company || null,
      jobTitle: p.jobTitle || f.jobTitle || null,
      location: p.location || f.location || null,
      bio: p.bio || f.bio || null,
      ...(ownVideos ? { ownChannelAi: channelProfile.ai, ownChannelSummary: channelProfile.summary, deepReadAt: new Date() } : {}),
      enrichedAt: new Date(),
      enrichNotes: [...f.notes, taken.size ? `${taken.size} address(es) already belong to another prospect` : ''].filter(Boolean).join('\n') || 'Nothing public found beyond the YouTube profile',
    },
  })
  await refreshProspects([p.id])
  await updateStatus(p.id)
  return newEmails.filter((e) => e.source !== 'PATTERN').length
}

function pick<T extends object, K extends keyof T>(o: T, keys: K[]) {
  return Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>
}

// ─── 3b. Identity (web search) ───────────────────────────────────────────────
// Only for people worth contacting whose YouTube footprint gave us no site or LinkedIn.

function outreachRelevance(s: AudienceSettings) {
  return s.outreachFrom === 'HIGH' ? ['HIGH'] : ['HIGH', 'MEDIUM']
}

export async function identityStep(deadline: number, settings: AudienceSettings, onlyIds?: string[]) {
  const out = { searched: 0, websites: 0, linkedIn: 0, emailsFound: 0, errors: [] as string[] }
  if (!searchProvider() || !settings.useWebSearch) return out
  const batch = await prisma.prospect.findMany({
    where: onlyIds ? { id: { in: onlyIds } } : {
      webSearchedAt: null, enrichedAt: { not: null }, relevance: { in: outreachRelevance(settings) },
      website: null, linkedIn: null, status: { notIn: ['DO_NOT_CONTACT', 'IN_CAMPAIGN', 'READY_TO_CONTACT'] },
    },
    orderBy: { intentScore: 'desc' },
    take: onlyIds ? onlyIds.length : 6,
  })
  for (const p of batch) {
    if (left(deadline) < 15_000) break
    try {
      const id = await resolveIdentity(p)
      out.searched++
      const found: Findings = { emails: [], otherLinks: [], notes: [...id.notes] }
      // A confirmed site gets the same polite crawl as a site they linked themselves
      if (id.website && left(deadline) > 12_000) await crawlWebsite(id.website, found)
      const emailsAdded = await saveEmails(p.id, found.emails)
      if (id.website) out.websites++
      if (id.linkedIn) out.linkedIn++
      out.emailsFound += emailsAdded
      await prisma.prospect.update({
        where: { id: p.id },
        data: {
          webSearchedAt: new Date(),
          website: p.website || id.website || null,
          linkedIn: p.linkedIn || id.linkedIn || null,
          twitter: p.twitter || id.twitter || null,
          company: p.company || id.company || found.company || null,
          jobTitle: p.jobTitle || id.jobTitle || null,
          enrichNotes: [p.enrichNotes, ...found.notes].filter(Boolean).join('\n').slice(0, 3000),
        },
      })
      await refreshProspects([p.id])
      await updateStatus(p.id, settings)
    } catch (err) {
      out.errors.push(`${p.displayName}: ${(err as Error).message}`)
      await prisma.prospect.update({ where: { id: p.id }, data: { webSearchedAt: new Date() } })
    }
  }
  return out
}

// ─── 3c. Email finders (Hunter → Apollo) ─────────────────────────────────────
// Licensed B2B data, asked once per person, only when we know who they are and where they work.
// Two jobs:
//   find    – high-intent person with a known identity but no business email → find it
//   enrich  – high-intent person with a business email but unclear identity → Hunter tells us
//             whose address it is (name, title, company, LinkedIn), which can make them ready
// Hunter credits are checked for free first and never used below the reserve.

export async function finderStep(deadline: number, settings: AudienceSettings, onlyIds?: string[]) {
  const out = { asked: 0, found: 0, enriched: 0, hunterCredits: null as number | null, stoppedAtReserve: false, errors: [] as string[] }
  if (!finderProviders().length || !settings.useFinders) return out

  let credits = Infinity
  if (hunterConfigured()) {
    try {
      const acc = await hunterAccount()
      credits = acc?.remaining ?? 0
      out.hunterCredits = credits
    } catch (err) {
      out.errors.push(`Hunter account: ${(err as Error).message}`)
      credits = 0
    }
  }
  const hunterLeft = () => credits > settings.hunterReserve
  if (!hunterLeft() && !process.env.APOLLO_API_KEY) {
    out.stoppedAtReserve = true
    return out
  }

  const base = onlyIds ? { id: { in: onlyIds } } : {
    finderCheckedAt: null, enrichedAt: { not: null }, relevance: { in: outreachRelevance(settings) },
    status: { notIn: ['DO_NOT_CONTACT', 'IN_CAMPAIGN', 'READY_TO_CONTACT'] },
  }
  const batch = await prisma.prospect.findMany({
    where: onlyIds ? base : {
      ...base,
      OR: [
        // find: identity known, no verified business email yet
        {
          AND: [
            { OR: [{ linkedIn: { not: null } }, { website: { not: null } }, { AND: [{ firstName: { not: null } }, { lastName: { not: null } }, { company: { not: null } }] }] },
            { emails: { none: { status: 'VERIFIED', isFree: false } } },
          ],
        },
        // enrich: has a business address but we don't know enough about who owns it
        { AND: [{ identityScore: { lt: settings.minIdentity } }, { emails: { some: { isFree: false, status: { not: 'INVALID' } } } }] },
      ],
    },
    include: { emails: true },
    orderBy: { intentScore: 'desc' },
    take: onlyIds ? onlyIds.length : 8,
  })

  for (const p of batch) {
    if (left(deadline) < 10_000) break
    const notes: string[] = []
    const businessEmail = p.emails.find((e) => !e.isFree && e.status !== 'INVALID')

    // enrich: whose address is this?
    if (businessEmail && p.identityScore < settings.minIdentity && hunterConfigured() && hunterLeft()) {
      try {
        const who = await hunterEnrich(businessEmail.email)
        credits -= 1
        if (who) {
          const website = p.website || (who.companyDomain ? `https://${who.companyDomain}` : null)
          await prisma.prospect.update({
            where: { id: p.id },
            data: {
              firstName: p.firstName || who.firstName || null,
              lastName: p.lastName || who.lastName || null,
              jobTitle: p.jobTitle || who.title || null,
              company: p.company || who.companyName || null,
              website,
              linkedIn: p.linkedIn || who.linkedIn || null,
              twitter: p.twitter || who.twitter || null,
              location: p.location || who.city || null,
              ...(!p.country && who.country ? { country: who.country.toUpperCase(), region: regionOf(who.country), consentSensitive: CONSENT_SENSITIVE.has(who.country.toUpperCase()) } : {}),
            },
          })
          Object.assign(p, { website, firstName: p.firstName || who.firstName, lastName: p.lastName || who.lastName, company: p.company || who.companyName, linkedIn: p.linkedIn || who.linkedIn })
          out.enriched++
          notes.push(`Hunter enrichment for ${businessEmail.email}: ${[who.firstName, who.lastName].filter(Boolean).join(' ') || 'no name'}${who.title ? `, ${who.title}` : ''}${who.companyName ? ` at ${who.companyName}` : ''}`)
        } else notes.push(`Hunter enrichment: nothing known about ${businessEmail.email}`)
      } catch (err) {
        if (err instanceof HunterLimitError) credits = 0
        notes.push(`Hunter enrichment: ${(err as Error).message}`)
      }
    }

    // find: a business email for someone we can identify
    const hasVerifiedBusiness = p.emails.some((e) => e.status === 'VERIFIED' && !e.isFree)
    if (!hasVerifiedBusiness && (hunterLeft() || process.env.APOLLO_API_KEY)) {
      const { found, notes: fNotes, outOfCredits } = await findBusinessEmail(p, { hunter: hunterLeft() })
      notes.push(...fNotes)
      if (outOfCredits) credits = 0
      out.asked++
      if (found) {
        if (found.source === 'HUNTER') credits -= 1
        const taken = await prisma.prospectEmail.findUnique({ where: { email: found.email } })
        if (!taken) {
          const finderChecked = found.status !== 'UNKNOWN'
          await prisma.prospectEmail.create({
            data: {
              prospectId: p.id, email: found.email, source: found.source, sourceUrl: found.sourceUrl || null,
              confidence: found.confidence, ...pick(emailTraits(found.email), ['isFree', 'isRole']),
              // The finder already checked the mailbox; otherwise the verify step does it
              ...(finderChecked || !verifierProvider()
                ? { status: found.status, verifyMethod: found.source, verifyDetail: found.detail.slice(0, 250), checkedAt: new Date() }
                : { verifyDetail: found.detail.slice(0, 250) }),
            },
          })
          out.found++
        }
      }
    }

    await prisma.prospect.update({
      where: { id: p.id },
      data: { finderCheckedAt: new Date(), enrichNotes: [p.enrichNotes, ...notes].filter(Boolean).join('\n').slice(-3000) },
    })
    await refreshProspects([p.id])
    await updateStatus(p.id, settings)
    if (!hunterLeft() && !process.env.APOLLO_API_KEY) { out.stoppedAtReserve = true; break }
  }
  if (Number.isFinite(credits)) out.hunterCredits = Math.max(0, credits)
  return out
}

/** Attach new addresses to a person; an address that belongs to someone else is skipped */
async function saveEmails(prospectId: string, emails: Findings['emails']) {
  if (!emails.length) return 0
  const taken = new Set((await prisma.prospectEmail.findMany({ where: { email: { in: emails.map((e) => e.email) } }, select: { email: true } })).map((e) => e.email))
  const fresh = emails.filter((e) => !taken.has(e.email))
  if (fresh.length) {
    await prisma.prospectEmail.createMany({
      data: fresh.map((e) => ({ prospectId, email: e.email, source: e.source, sourceUrl: e.sourceUrl || null, ...pick(emailTraits(e.email), ['isFree', 'isRole']) })),
      skipDuplicates: true,
    })
  }
  return fresh.length
}

// ─── Re-score ────────────────────────────────────────────────────────────────

/** People collected before intent scoring existed get scored the first time the pipeline runs */
export async function rescoreLegacy(deadline: number) {
  let n = 0
  while (left(deadline) > 5_000) {
    const ids = (await prisma.prospect.findMany({
      where: { intentScore: 0, intentEvidence: { isEmpty: true }, commentCount: { gt: 0 } },
      select: { id: true }, take: 200,
    })).map((p) => p.id)
    if (!ids.length) break
    await refreshProspects(ids)
    // Anyone still at zero has no usable comments: mark so the sweep doesn't loop on them
    await prisma.prospect.updateMany({ where: { id: { in: ids }, intentScore: 0, intentEvidence: { isEmpty: true } }, data: { intentEvidence: ['No buying signals'] } })
    n += ids.length
  }
  return n
}

// ─── 4. Verify ───────────────────────────────────────────────────────────────

export async function verifyPending(deadline: number, onlyProspectIds?: string[]) {
  const out = { checked: 0, verified: 0, invalid: 0 }
  const retryBefore = new Date(Date.now() - 86_400_000)
  const pending = await prisma.prospectEmail.findMany({
    where: {
      ...(onlyProspectIds ? { prospectId: { in: onlyProspectIds } } : {}),
      prospect: { status: { not: 'DO_NOT_CONTACT' } },
      OR: [
        { checkedAt: null },
        // provider hiccups get another try the next day
        { status: 'UNKNOWN', verifyDetail: { startsWith: 'verifier error' }, checkedAt: { lt: retryBefore } },
        ...(onlyProspectIds ? [{ status: 'UNKNOWN' }] : []),
      ],
    },
    orderBy: [{ prospect: { score: 'desc' } }, { source: 'asc' }],
    take: 40,
  })
  const touched = new Set<string>()
  const hasVerified = new Set((await prisma.prospectEmail.findMany({
    where: { prospectId: { in: [...new Set(pending.map((e) => e.prospectId))] }, status: 'VERIFIED' }, select: { prospectId: true },
  })).map((e) => e.prospectId))

  for (const e of pending) {
    if (left(deadline) < 5_000) break
    // Don't spend credits on guesses once the person has a confirmed address
    if (e.source === 'PATTERN' && hasVerified.has(e.prospectId)) {
      await prisma.prospectEmail.delete({ where: { id: e.id } })
      continue
    }
    const v = await verifyEmail(e.email)
    out.checked++
    touched.add(e.prospectId)
    if (e.source === 'PATTERN' && v.status !== 'VERIFIED') {
      await prisma.prospectEmail.delete({ where: { id: e.id } }) // an unconfirmed guess is noise
      continue
    }
    if (v.status === 'VERIFIED') { out.verified++; hasVerified.add(e.prospectId) }
    if (v.status === 'INVALID') out.invalid++
    await prisma.prospectEmail.update({
      where: { id: e.id },
      data: { status: v.status, verifyMethod: v.method, verifyDetail: v.detail.slice(0, 250), checkedAt: new Date() },
    })
  }
  for (const id of touched) await updateStatus(id)
  return out
}

// ─── 5. Status ───────────────────────────────────────────────────────────────

// Addresses the person put out there themselves
const PUBLISHED = ['CHANNEL', 'CHANNEL_VIDEO', 'WEBSITE', 'LINK_PAGE', 'MANUAL', 'COMMENT']
// …published for being contacted (bio, video "business inquiries", contact page)
const CONSPICUOUS = ['CHANNEL', 'CHANNEL_VIDEO', 'WEBSITE', 'LINK_PAGE', 'MANUAL']

type SendableProspect = Pick<Prospect, 'consentSensitive' | 'country' | 'relevance'>

/** May we email this address, under the verification policy, email-quality rule and the country's rules? */
export function isSendable(e: Pick<ProspectEmail, 'status' | 'source' | 'verifyMethod' | 'isFree'>, p: SendableProspect, s: AudienceSettings) {
  if (e.status === 'INVALID' || e.status === 'RISKY') return false
  const verified = e.status === 'VERIFIED'
  // verifyMethod is set once the address has been checked (at least its domain accepts mail)
  const published = s.sendPolicy === 'VERIFIED_OR_PUBLISHED' && e.status === 'UNKNOWN' && !!e.verifyMethod && PUBLISHED.includes(e.source)
  if (!verified && !published) return false
  // No "normal people" inboxes: a gmail address only when they offered it for contact and clearly want to build
  if (s.businessEmailsOnly && e.isFree && !(CONSPICUOUS.includes(e.source) && p.relevance === 'HIGH')) return false
  if (s.strictRegions && p.consentSensitive && !CONSPICUOUS.includes(e.source)) return false
  if (s.countries.length && p.country && !s.countries.includes(p.country)) return false
  return true
}

/** Best address to use: verified personal business > verified role > published */
export function bestEmail<T extends Pick<ProspectEmail, 'status' | 'source' | 'verifyMethod' | 'isRole' | 'isFree' | 'isPrimary'> & { confidence?: number | null }>(emails: T[], p: SendableProspect, s: AudienceSettings) {
  const rank = (e: T) => (e.isPrimary ? 100 : 0) + (e.status === 'VERIFIED' ? 50 : 0) + (e.isRole ? 0 : 20) + (e.isFree ? 0 : 15) +
    (CONSPICUOUS.includes(e.source) ? 3 : 0) + Math.round((e.confidence || 0) / 20)
  return emails.filter((e) => isSendable(e, p, s)).sort((a, b) => rank(b) - rank(a))[0] || null
}

/** Why someone isn't ready yet (shown in the UI), or null when they are */
export function readinessGap(p: SendableProspect & { identityScore: number; emails: Array<Parameters<typeof isSendable>[0] & { source: string }> }, s: AudienceSettings) {
  const minRank = RANK[s.outreachFrom]
  if (RANK[p.relevance] < minRank) return `Intent is ${p.relevance.toLowerCase()}; outreach starts at ${s.outreachFrom.toLowerCase()}`
  const manual = p.emails.some((e) => e.source === 'MANUAL')
  if (p.identityScore < s.minIdentity && !manual) return `Identity ${p.identityScore}/100 (needs ${s.minIdentity}): no confirmed site, LinkedIn or company yet`
  const live = p.emails.filter((e) => e.status !== 'INVALID')
  if (!live.length) return 'No email found yet'
  if (!live.some((e) => isSendable(e, p, s))) {
    if (s.businessEmailsOnly && live.every((e) => e.isFree)) return 'Only a personal (free-mail) address, which the business-email rule blocks'
    if (live.every((e) => e.status !== 'VERIFIED')) return 'Email not verified yet'
    return 'No email passes the country rules'
  }
  return null
}

export async function updateStatus(prospectId: string, settings?: AudienceSettings) {
  const s = settings || await getAudienceSettings()
  const p = await prisma.prospect.findUnique({ where: { id: prospectId }, include: { emails: true, lead: { select: { id: true } } } })
  if (!p || p.status === 'DO_NOT_CONTACT') return p?.status
  const live = p.emails.filter((e) => e.status !== 'INVALID')

  let status: string
  if (p.lead) status = 'IN_CAMPAIGN'
  else if (p.emails.length && !live.length) status = 'INVALID_EMAIL'
  else if (live.length) {
    status = !readinessGap(p, s) ? 'READY_TO_CONTACT'
      : live.some((e) => e.status === 'VERIFIED') ? 'EMAIL_VERIFIED' : 'EMAIL_FOUND'
  } else if (!p.enrichedAt) status = p.status === 'RESEARCHING' ? 'RESEARCHING' : 'NEW'
  else status = p.website || p.linkedIn || p.company ? 'PROFILE_FOUND' : 'NO_CONTACT'

  if (status !== p.status) await prisma.prospect.update({ where: { id: p.id }, data: { status } })
  return status
}

export async function updateAllStatuses(deadline: number) {
  const s = await getAudienceSettings()
  const ids = await prisma.prospect.findMany({ where: { OR: [{ emails: { some: {} } }, { enrichedAt: { not: null } }] }, select: { id: true } })
  let n = 0
  for (const { id } of ids) {
    if (left(deadline) < 3_000) break
    await updateStatus(id, s)
    n++
  }
  return n
}

// ─── Retention ───────────────────────────────────────────────────────────────

/** Irrelevant public data is not kept: comments and people we will never contact are deleted */
export async function purgeStale(retentionDays: number) {
  const before = new Date(Date.now() - retentionDays * 86_400_000)
  const comments = await prisma.audienceComment.deleteMany({
    where: { createdAt: { lt: before }, relevance: { in: ['LOW', 'SPAM'] }, prospect: { relevance: { in: ['LOW', 'SPAM'] }, lead: null } },
  })
  const people = await prisma.prospect.deleteMany({
    where: { createdAt: { lt: before }, relevance: { in: ['LOW', 'SPAM'] }, lead: null, emails: { none: {} }, status: { not: 'DO_NOT_CONTACT' } },
  })
  return { comments: comments.count, prospects: people.count }
}

// ─── Orchestration ───────────────────────────────────────────────────────────

const PURGE_KEY = 'audience_last_purge'

export type PipelineStep = 'collect' | 'review' | 'enrich' | 'identity' | 'finder' | 'verify'

export async function runAudiencePipeline(deadline: number, only?: PipelineStep) {
  const settings = await getAudienceSettings()
  const result: Record<string, unknown> = {}
  const share = (fraction: number) => Math.min(deadline, Date.now() + (deadline - Date.now()) * fraction)

  if (!only) {
    const rescored = await rescoreLegacy(share(0.15))
    if (rescored) result.rescored = rescored
  }
  if (!only || only === 'collect') result.collect = await collectComments(only ? deadline : share(0.35))
  if (!only || only === 'review') result.review = await aiReview(only ? deadline : share(0.3), settings)
  if (!only || only === 'enrich') result.enrich = await enrichProspects(only ? deadline : share(0.5), settings)
  if (!only || only === 'identity') result.identity = await identityStep(only ? deadline : share(0.5), settings)
  if (!only || only === 'finder') result.finder = await finderStep(only ? deadline : share(0.6), settings)
  if (!only || only === 'verify') result.verify = await verifyPending(deadline)

  if (!only) {
    const last = await prisma.setting.findUnique({ where: { key: PURGE_KEY } })
    if (!last || Date.now() - Number(last.value) > 86_400_000) {
      result.purged = await purgeStale(settings.retentionDays)
      const value = String(Date.now())
      await prisma.setting.upsert({ where: { key: PURGE_KEY }, create: { key: PURGE_KEY, value }, update: { value } })
    }
  }
  return result
}

/** Is there anything left for the pipeline to do? (drives the "Run" button loop) */
export async function pipelineBacklog() {
  const s = await getAudienceSettings()
  const outreach = s.outreachFrom === 'HIGH' ? ['HIGH'] : ['HIGH', 'MEDIUM']
  const [videos, review, enrich, verify, identity, finder] = await Promise.all([
    prisma.audienceVideo.count({ where: { status: { in: ['QUEUED', 'COLLECTING'] } } }),
    aiConfigured() && s.useAi ? prisma.prospect.count({ where: { aiCheckedAt: null, relevance: { not: 'SPAM' }, score: { gte: 25 }, status: { not: 'DO_NOT_CONTACT' } } }) : 0,
    prisma.prospect.count({ where: { enrichedAt: null, relevance: { in: s.enrichFrom === 'HIGH' ? ['HIGH'] : ['HIGH', 'MEDIUM'] }, status: { notIn: ['DO_NOT_CONTACT', 'IN_CAMPAIGN'] }, enrichAttempts: { lt: 3 } } }),
    prisma.prospectEmail.count({ where: { checkedAt: null, prospect: { status: { not: 'DO_NOT_CONTACT' } } } }),
    searchProvider() && s.useWebSearch ? prisma.prospect.count({ where: { webSearchedAt: null, enrichedAt: { not: null }, relevance: { in: outreach }, website: null, linkedIn: null, status: { notIn: ['DO_NOT_CONTACT', 'IN_CAMPAIGN', 'READY_TO_CONTACT'] } } }) : 0,
    finderProviders().length && s.useFinders ? prisma.prospect.count({
      where: {
        finderCheckedAt: null, enrichedAt: { not: null }, relevance: { in: outreach }, status: { notIn: ['DO_NOT_CONTACT', 'IN_CAMPAIGN', 'READY_TO_CONTACT'] },
        OR: [
          { AND: [{ OR: [{ linkedIn: { not: null } }, { website: { not: null } }, { AND: [{ firstName: { not: null } }, { lastName: { not: null } }, { company: { not: null } }] }] }, { emails: { none: { status: 'VERIFIED', isFree: false } } }] },
          { AND: [{ identityScore: { lt: s.minIdentity } }, { emails: { some: { isFree: false, status: { not: 'INVALID' } } } }] },
        ],
      },
    }) : 0,
  ])
  return { videos, review, enrich, identity, finder, verify, total: videos + review + enrich + identity + finder + verify }
}
