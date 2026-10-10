// Receptionist buyers: the server side of lib/audience/buyer-rules.ts.
//
//   collect  → comments of BUYER-track videos are scored with the buyer phrases; anyone with a
//              medium or high phrase becomes a BuyerProspect (everyone else is ignored)
//   check    → their public channel page: is the name a business? a website? a US location?
//   tier     → A (high intent + business details) · B (high intent only) · C (the rest)
//   promote  → Tier A becomes a Lead Finder business, so the business's own public contact is
//              found, verified and sent through the matching niche campaign. Personal emails are
//              never looked up from a comment
//   reply    → Tier B lands on the "reply publicly" list with a suggested wording; a person posts it
import type { BuyerProspect, Prisma } from '@prisma/client'
import prisma from '../prisma'
import { getChannels, youtubeConfigured } from './youtube'
import { hostOf } from './enrich'
import { ownDomain } from '../finder/research'
import { rescore } from '../finder/pipeline'
import { nicheOf } from '../finder/niches'
import { classifyBuyerComment, businessNameOf, usLocation, tierOf, isHighSignal, isNegativeSignal, suggestReply, BUYER_SIGNAL_LABEL, type BuyerVerdict } from './buyer-rules'

const left = (deadline: number) => deadline - Date.now()

export interface BuyerComment {
  externalId: string; authorExternalId: string; authorName: string; avatarUrl: string | null
  text: string; likeCount: number; replyCount: number; parentId: string | null; publishedAt: Date | null
}

/** Store the comments of a BUYER-track video and keep the people worth a second look */
export async function ingestBuyerComments(video: { id: string; title: string }, comments: BuyerComment[]) {
  if (!comments.length) return { inserted: 0, newProspects: 0 }
  const copied = await copiedTexts(video.id, comments)
  const best = new Map<string, { c: BuyerComment; points: number }>()
  const rows: Prisma.AudienceCommentCreateManyInput[] = comments.map((c) => {
    const v = copied.has(textKey(c.text)) ? DUPLICATE : classifyBuyerComment(c.text, { videoText: video.title, authorName: c.authorName })
    const cur = best.get(c.authorExternalId)
    if (!cur || v.points > cur.points) best.set(c.authorExternalId, { c, points: v.points })
    return {
      youtubeCommentId: c.externalId, videoId: video.id, prospectId: null,
      authorChannelId: c.authorExternalId, authorName: c.authorName, text: c.text.slice(0, 5000),
      likeCount: c.likeCount, replyCount: c.replyCount, isReply: !!c.parentId, parentCommentId: c.parentId, publishedAt: c.publishedAt,
      language: v.signals.includes('non_english') ? 'other' : 'en',
      relevance: v.relevance, score: Math.max(0, Math.min(100, v.points)),
      persona: v.signals.some((s) => ['runs_business', 'my_company', 'one_man'].includes(s)) ? 'BUSINESS_OWNER' : null,
      interestCategory: 'RECEPTION_BUYER', topic: v.trade, signals: v.signals,
    }
  })
  const inserted = await prisma.audienceComment.createMany({ data: rows, skipDuplicates: true })

  // Tier C is "ignore": only people with at least a medium phrase are kept
  const keep = [...best.entries()].filter(([, b]) => b.points >= 3)
  const created = keep.length ? await prisma.buyerProspect.createMany({
    data: keep.map(([id, b]) => ({
      youtubeChannelId: id, displayName: b.c.authorName.replace(/^@/, ''),
      handle: b.c.authorName.startsWith('@') ? b.c.authorName : null, avatarUrl: b.c.avatarUrl,
    })),
    skipDuplicates: true,
  }) : { count: 0 }
  await refreshBuyers(keep.map(([id]) => id))
  return { inserted: inserted.count, newProspects: created.count }
}

const DUPLICATE: BuyerVerdict = { points: -5, signals: ['duplicate'], high: false, relevance: 'SPAM', trade: null }
const textKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Texts posted word for word by more than one account on this video (in this batch or earlier) */
async function copiedTexts(videoId: string, comments: Array<{ text: string; authorExternalId: string }>) {
  const authors = new Map<string, Set<string>>()
  const add = (text: string, author: string | null) => {
    const k = textKey(text)
    if (k.length < 25 || !author) return
    authors.set(k, (authors.get(k) || new Set()).add(author))
  }
  for (const c of comments) add(c.text, c.authorExternalId)
  const earlier = await prisma.audienceComment.findMany({ where: { videoId, text: { in: comments.map((c) => c.text.slice(0, 5000)) } }, select: { text: true, authorChannelId: true } })
  for (const e of earlier) add(e.text, e.authorChannelId)
  return new Set([...authors.entries()].filter(([, a]) => a.size > 1).map(([k]) => k))
}

/**
 * Comments of buyer videos that were stored by the AI Builder path (a video whose track changed
 * after it was queued): re-score them with the buyer phrases and detach them from the builder list.
 */
export async function repairBuyerComments() {
  const wrong = await prisma.audienceComment.findMany({
    where: { video: { track: 'BUYER' }, OR: [{ prospectId: { not: null } }, { interestCategory: { not: 'RECEPTION_BUYER' } }, { interestCategory: null }] },
    select: { id: true, text: true, authorChannelId: true, authorName: true, prospectId: true, video: { select: { title: true } } },
  })
  if (!wrong.length) return { comments: 0, prospectsRemoved: 0 }
  const authors = new Map<string, { name: string; points: number }>()
  for (const c of wrong) {
    const v = classifyBuyerComment(c.text, { videoText: c.video.title, authorName: c.authorName })
    await prisma.audienceComment.update({
      where: { id: c.id },
      data: {
        prospectId: null, relevance: v.relevance, score: Math.max(0, Math.min(100, v.points)), signals: v.signals, topic: v.trade,
        interestCategory: 'RECEPTION_BUYER', persona: v.signals.some((s) => ['runs_business', 'my_company', 'one_man'].includes(s)) ? 'BUSINESS_OWNER' : null,
      },
    })
    if (c.authorChannelId && v.points > (authors.get(c.authorChannelId)?.points ?? -99)) authors.set(c.authorChannelId, { name: c.authorName, points: v.points })
  }
  // Builder-list people who only ever commented on buyer videos don't belong there
  const removed = await prisma.prospect.deleteMany({
    where: { id: { in: [...new Set(wrong.map((c) => c.prospectId).filter(Boolean) as string[])] }, comments: { none: {} }, lead: null, emails: { none: {} }, status: { notIn: ['DO_NOT_CONTACT', 'IN_CAMPAIGN'] } },
  })
  const keep = [...authors.entries()].filter(([, a]) => a.points >= 3)
  if (keep.length) await prisma.buyerProspect.createMany({ data: keep.map(([id, a]) => ({ youtubeChannelId: id, displayName: a.name.replace(/^@/, ''), handle: a.name.startsWith('@') ? a.name : null })), skipDuplicates: true })
  await refreshBuyers(keep.map(([id]) => id))
  return { comments: wrong.length, prospectsRemoved: removed.count }
}

/** Recompute score, signals, trade, location and tier from everything a person wrote */
export async function refreshBuyers(channelIds: string[]) {
  if (!channelIds.length) return
  const [buyers, comments] = await Promise.all([
    prisma.buyerProspect.findMany({ where: { youtubeChannelId: { in: channelIds } } }),
    prisma.audienceComment.findMany({
      where: { authorChannelId: { in: channelIds }, video: { track: 'BUYER' } },
      select: { youtubeCommentId: true, authorChannelId: true, text: true, publishedAt: true, videoId: true, relevance: true, signals: true, video: { select: { title: true } } },
    }),
  ])
  for (const b of buyers) {
    const mine = comments.filter((c) => c.authorChannelId === b.youtubeChannelId)
      .map((c) => ({ c, v: c.signals.includes('duplicate') ? DUPLICATE : classifyBuyerComment(c.text, { videoText: c.video.title, authorName: b.displayName }) }))
      .sort((x, y) => y.v.points - x.v.points)
    if (!mine.length) continue
    const top = mine[0]
    // The best comment's points, plus one for each other comment that mentions their work (max 3)
    const score = top.v.points + Math.min(3, mine.slice(1).filter((m) => m.v.points >= 3).length)
    const signals = [...new Set(mine.flatMap((m) => m.v.signals))]
    // A channel that links to Telegram / WhatsApp is a spam account, whatever it wrote
    const spamChannel = /\b(t\.me|telegram|wa\.me|whatsapp)\b/i.test(b.channelDescription || '')
    if (spamChannel && !signals.includes('spam')) signals.push('spam')
    const high = !spamChannel && mine.some((m) => m.v.high)
    const trade = b.trade || mine.find((m) => m.v.trade)?.v.trade || null
    const place = usLocation(...mine.map((m) => m.c.text), b.channelDescription)
    const location = b.location || (place ? [place.city, place.state].filter(Boolean).join(', ') : null)
    const videos = new Set(mine.map((m) => m.c.videoId)).size
    const evidence = [
      ...signals.filter(isHighSignal).map((s) => BUYER_SIGNAL_LABEL[s]),
      ...signals.filter((s) => !isHighSignal(s) && !isNegativeSignal(s) && BUYER_SIGNAL_LABEL[s] && s !== 'short').map((s) => BUYER_SIGNAL_LABEL[s]),
      ...signals.filter(isNegativeSignal).map((s) => `Against: ${BUYER_SIGNAL_LABEL[s]}`),
      ...(b.businessName ? [`Channel is a business: ${b.businessName}`] : []),
      ...(b.website ? [`Business website: ${hostOf(b.website)}`] : []),
      ...(location ? [`Location: ${location}`] : []),
      ...(mine.length > 1 ? [`${mine.length} comments on ${videos} video${videos === 1 ? '' : 's'}`] : []),
    ]
    const tier = tierOf({ high, score, businessName: b.businessName, website: b.website, country: b.country })
    // Tier B waits for a public reply; anything else leaves the to-do list (sent / answered stay as they are)
    const replyStatus = tier === 'B' && b.replyStatus === 'NONE' ? 'TODO' : tier === 'C' && b.replyStatus === 'TODO' ? 'NONE' : b.replyStatus
    await prisma.buyerProspect.update({
      where: { id: b.id },
      data: {
        score, signals, evidence, trade, location, tier, replyStatus, commentCount: mine.length,
        bestCommentId: top.c.youtubeCommentId, bestCommentText: top.c.text.slice(0, 2000), bestVideoId: top.c.videoId,
        lastCommentAt: mine.map((m) => m.c.publishedAt).filter(Boolean).sort((x, y) => y!.getTime() - x!.getTime())[0] || null,
      },
    })
  }
}

// Links that are not a business's own site: messengers, shorteners, link pages, payment and store pages
const NOT_A_SITE = /(^|\.)(t\.me|telegram\.(me|org)|wa\.me|whatsapp\.com|bit\.ly|tinyurl\.com|cutt\.ly|rb\.gy|linktr\.ee|beacons\.ai|bio\.link|lnk\.bio|discord\.(gg|com)|patreon\.com|paypal\.(me|com)|cash\.app|venmo\.com|gofundme\.com|amazon\.[a-z.]+|amzn\.to|etsy\.com|ebay\.com|gumroad\.com|skool\.com|whop\.com|calendly\.com|forms\.gle|google\.com|youtu\.be|youtube\.com|twitch\.tv|spotify\.com|apple\.com|onlyfans\.com|snapchat\.com|threads\.net|pinterest\.[a-z.]+|reddit\.com|medium\.com|substack\.com|github\.com)$/i

const URL_RE = /\bhttps?:\/\/[^\s<>()"']+|\b(?:www\.)[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>()"']*/gi

/** Read the public channel page of people with a high-intent comment: business name, website, country */
export async function checkBuyers(deadline: number) {
  const out = { checked: 0, businesses: 0, error: '' }
  if (!youtubeConfigured()) return out
  const batch = await prisma.buyerProspect.findMany({ where: { checkedAt: null, tier: { in: ['A', 'B'] } }, orderBy: { score: 'desc' }, take: 50 })
  if (!batch.length || left(deadline) < 8_000) return out
  try {
    const channels = new Map((await getChannels(batch.map((b) => b.youtubeChannelId))).map((c) => [c.id, c])) // 1 quota unit for all 50
    for (const b of batch) {
      const c = channels.get(b.youtubeChannelId)
      const description = c?.snippet.description || ''
      const website = (description.match(URL_RE) || []).map((u) => (/^https?:/i.test(u) ? u : `https://${u}`)).find((u) => ownDomain(u) && !NOT_A_SITE.test(hostOf(u))) || null
      const businessName = businessNameOf(c?.snippet.title || b.displayName)
      await prisma.buyerProspect.update({
        where: { id: b.id },
        data: {
          checkedAt: new Date(),
          ...(c ? { displayName: c.snippet.title || b.displayName, handle: c.snippet.customUrl || b.handle, channelDescription: description.slice(0, 3000) || null, country: c.snippet.country || b.country } : {}),
          businessName, website: website ? `https://${hostOf(website)}` : null,
        },
      })
      out.checked++
      if (businessName || website) out.businesses++
    }
    await refreshBuyers(batch.map((b) => b.youtubeChannelId))
  } catch (err) {
    out.error = (err as Error).message.slice(0, 200)
  }
  return out
}

export function commentUrl(youtubeVideoId?: string | null, commentId?: string | null) {
  return youtubeVideoId ? `https://www.youtube.com/watch?v=${youtubeVideoId}${commentId ? `&lc=${commentId}` : ''}` : null
}

const YT_FACT = 'Said on YouTube'

/**
 * Tier A → a Lead Finder business. From there the normal research finds the business's own
 * public contact (website, listing), checks the mailbox and routes it to its niche campaign.
 * A Tier A person we can't look up (no website, no location) gets a public reply instead.
 */
export async function promoteBuyers(deadline: number) {
  const out = { promoted: 0, linked: 0, toReply: 0 }
  const batch = await prisma.buyerProspect.findMany({ where: { tier: 'A', businessId: null }, orderBy: { score: 'desc' }, take: 25 })
  for (const b of batch) {
    if (left(deadline) < 5_000) break
    const domain = b.website ? ownDomain(b.website) : ''
    if (!domain && !(b.businessName && b.location)) {
      if (b.replyStatus === 'NONE') { await prisma.buyerProspect.update({ where: { id: b.id }, data: { replyStatus: 'TODO' } }); out.toReply++ }
      continue
    }
    const video = b.bestVideoId ? await prisma.audienceVideo.findUnique({ where: { id: b.bestVideoId }, select: { youtubeVideoId: true } }) : null
    const fact = `${YT_FACT}: "${(b.bestCommentText || '').replace(/\s+/g, ' ').slice(0, 150)}"`
    const known = domain ? await prisma.business.findFirst({ where: { domain }, select: { id: true, siteFacts: true } }) : null
    let businessId = known?.id
    if (known) {
      if (!known.siteFacts.some((f) => f.startsWith(YT_FACT))) await prisma.business.update({ where: { id: known.id }, data: { siteFacts: [...known.siteFacts, fact] } })
      out.linked++
    } else {
      const [city, state] = (b.location || '').includes(',') ? b.location!.split(',').map((x) => x.trim()) : ['', b.location || '']
      const niche = nicheOf(b.trade)
      const created = await prisma.business.create({
        data: {
          placeId: `yt:${b.youtubeChannelId}`, source: 'YOUTUBE',
          name: (b.businessName || b.displayName).slice(0, 200), niche: niche?.id || null, category: niche?.label || null, types: [],
          city: city || null, state: state || null, country: b.country || 'US',
          website: b.website, domain: domain || null, mapsUrl: commentUrl(video?.youtubeVideoId, b.bestCommentId),
          siteFacts: [fact],
        },
        select: { id: true },
      }).catch(() => prisma.business.findUnique({ where: { placeId: `yt:${b.youtubeChannelId}` }, select: { id: true } }))
      businessId = created?.id
      out.promoted++
    }
    if (!businessId) continue
    await prisma.buyerProspect.update({ where: { id: b.id }, data: { businessId } })
    await rescore(businessId)
  }
  return out
}

/** Worker step: check channels, then send Tier A on to the Lead Finder */
export async function buyerStep(deadline: number) {
  const pending = await prisma.buyerProspect.count({ where: { OR: [{ checkedAt: null, tier: { in: ['A', 'B'] } }, { tier: 'A', businessId: null, replyStatus: 'NONE' }] } })
  if (!pending) { const repaired = await repairBuyerComments(); return { checked: 0, promoted: 0, ...(repaired.comments ? { repaired } : {}) } }
  await repairBuyerComments()
  const check = await checkBuyers(deadline)
  const promote = await promoteBuyers(deadline)
  return { ...check, ...promote }
}

export interface BuyerRow extends BuyerProspect {
  commentUrl: string | null; videoTitle: string | null; channelUrl: string; suggestedReply: string
  business: { id: string; name: string; status: string; fitScore: number; email: string | null } | null
}

/** Everything the Buyers page shows */
export async function buyerOverview() {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000)
  const [buyers, byTier, byReply, videos, repliesToday] = await Promise.all([
    prisma.buyerProspect.findMany({ where: { tier: { in: ['A', 'B'] } }, orderBy: [{ tier: 'asc' }, { score: 'desc' }, { lastCommentAt: 'desc' }], take: 400 }),
    prisma.buyerProspect.groupBy({ by: ['tier'], _count: true }),
    prisma.buyerProspect.groupBy({ by: ['replyStatus'], _count: true }),
    prisma.audienceVideo.findMany({
      where: { track: 'BUYER' }, orderBy: [{ updatedAt: 'desc' }], take: 200,
      select: { id: true, youtubeVideoId: true, title: true, status: true, score: true, scoreReasons: true, viewCount: true, commentCount: true, commentsCollected: true, publishedAt: true, lastError: true, channel: { select: { title: true } } },
    }),
    prisma.buyerProspect.count({ where: { replySentAt: { gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) } } }),
  ])
  const videoOf = new Map(videos.map((v) => [v.id, v]))
  const missing = [...new Set(buyers.map((b) => b.bestVideoId).filter((id): id is string => !!id && !videoOf.has(id)))]
  if (missing.length) for (const v of await prisma.audienceVideo.findMany({ where: { id: { in: missing } }, select: { id: true, youtubeVideoId: true, title: true, status: true, score: true, scoreReasons: true, viewCount: true, commentCount: true, commentsCollected: true, publishedAt: true, lastError: true, channel: { select: { title: true } } } })) videoOf.set(v.id, v)
  const businesses = new Map((await prisma.business.findMany({
    where: { id: { in: buyers.map((b) => b.businessId).filter(Boolean) as string[] } },
    select: { id: true, name: true, status: true, fitScore: true, emails: { where: { status: { not: 'INVALID' } }, select: { email: true }, take: 1 } },
  })).map((x) => [x.id, { id: x.id, name: x.name, status: x.status, fitScore: x.fitScore, email: x.emails[0]?.email || null }]))

  const rows: BuyerRow[] = buyers.map((b) => {
    const v = b.bestVideoId ? videoOf.get(b.bestVideoId) : null
    return {
      ...b, commentUrl: commentUrl(v?.youtubeVideoId, b.bestCommentId), videoTitle: v?.title || null,
      channelUrl: `https://www.youtube.com/channel/${b.youtubeChannelId}`,
      suggestedReply: suggestReply(b.id, b.signals), business: (b.businessId && businesses.get(b.businessId)) || null,
    }
  })

  // Weekly review: which videos produced people worth contacting, and did they answer
  const perVideo = new Map<string, { a: number; b: number; sent: number; responded: number }>()
  for (const b of await prisma.buyerProspect.findMany({ where: { bestVideoId: { not: null } }, select: { bestVideoId: true, tier: true, replyStatus: true } })) {
    const s = perVideo.get(b.bestVideoId!) || { a: 0, b: 0, sent: 0, responded: 0 }
    if (b.tier === 'A') s.a++
    if (b.tier === 'B') s.b++
    if (b.replyStatus === 'SENT' || b.replyStatus === 'RESPONDED') s.sent++
    if (b.replyStatus === 'RESPONDED') s.responded++
    perVideo.set(b.bestVideoId!, s)
  }
  const tierCount = (t: string) => byTier.find((r) => r.tier === t)?._count || 0
  const replyCount = (t: string) => byReply.find((r) => r.replyStatus === t)?._count || 0
  return {
    rows,
    videos: videos.map((v) => ({ ...v, yield: perVideo.get(v.id) || { a: 0, b: 0, sent: 0, responded: 0 } })),
    counts: {
      a: tierCount('A'), b: tierCount('B'), c: tierCount('C'),
      toReply: replyCount('TODO'), replied: replyCount('SENT'), responded: replyCount('RESPONDED'),
      inLeadFinder: buyers.filter((b) => b.businessId).length,
      newThisWeek: buyers.filter((b) => b.createdAt >= weekAgo).length,
      repliesToday,
    },
    youtube: youtubeConfigured(),
  }
}
