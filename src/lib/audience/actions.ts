// User-triggered audience actions: add sources, scan channels, push prospects into
// campaigns, opt people out, forget people.
import prisma from '../prisma'
import { scoreVideo } from './classify'
import {
  getChannels, getChannelByHandle, getVideos, latestUploadIds, parseYouTubeInput, searchChannels,
  isoDurationSeconds, bestThumb, type YtChannel, type YtVideo,
} from './youtube'
import { bestEmail, readinessGap, updateStatus } from './pipeline'
import { getAudienceSettings } from './settings'
import { INTERESTS, AUDIENCE_CAMPAIGNS, type Interest } from './taxonomy'

export { AUDIENCE_CAMPAIGNS }

// ─── Channels & videos ───────────────────────────────────────────────────────

const ON_TOPIC = /\b(ai|agents?|automat\w*|n8n|make\.com|zapier|no.?code|llm|gpt|chatgpt|claude|voice|saas|startup|business|agency|workflow|build)\b/gi

export async function saveChannel(c: YtChannel) {
  const text = `${c.snippet.title} ${c.snippet.description}`
  const topicScore = Math.min(100, new Set((text.match(ON_TOPIC) || []).map((w) => w.toLowerCase())).size * 12)
  const data = {
    title: c.snippet.title,
    handle: c.snippet.customUrl || null,
    description: c.snippet.description?.slice(0, 5000) || null,
    thumbnailUrl: bestThumb(c.snippet.thumbnails),
    country: c.snippet.country || null,
    subscriberCount: Number(c.statistics?.subscriberCount || 0),
    videoCount: Number(c.statistics?.videoCount || 0),
    viewCount: BigInt(c.statistics?.viewCount || 0),
    uploadsPlaylist: c.contentDetails?.relatedPlaylists?.uploads || null,
    topicScore,
  }
  return prisma.audienceChannel.upsert({
    where: { youtubeChannelId: c.id },
    create: { youtubeChannelId: c.id, ...data },
    update: data,
  })
}

/** Save videos (and their channels) with an audience-fit score. Existing videos keep their status. */
export async function saveVideos(videos: YtVideo[]) {
  const channelIds = [...new Set(videos.map((v) => v.snippet.channelId))]
  const knownChannels = await prisma.audienceChannel.findMany({ where: { youtubeChannelId: { in: channelIds } } })
  const missing = channelIds.filter((id) => !knownChannels.some((c) => c.youtubeChannelId === id))
  if (missing.length) for (const c of await getChannels(missing)) knownChannels.push(await saveChannel(c))
  const channelOf = new Map(knownChannels.map((c) => [c.youtubeChannelId, c.id]))

  const saved = []
  for (const v of videos) {
    const channelId = channelOf.get(v.snippet.channelId)
    if (!channelId) continue
    const stats = {
      viewCount: Number(v.statistics?.viewCount || 0),
      likeCount: Number(v.statistics?.likeCount || 0),
      commentCount: Number(v.statistics?.commentCount || 0),
    }
    const publishedAt = v.snippet.publishedAt ? new Date(v.snippet.publishedAt) : null
    const durationSeconds = isoDurationSeconds(v.contentDetails?.duration)
    const fit = scoreVideo({ title: v.snippet.title, description: v.snippet.description, ...stats, publishedAt, durationSeconds })
    const data = {
      channelId,
      title: v.snippet.title,
      description: v.snippet.description?.slice(0, 3000) || null,
      thumbnailUrl: bestThumb(v.snippet.thumbnails),
      publishedAt,
      durationSeconds,
      language: v.snippet.defaultAudioLanguage || v.snippet.defaultLanguage || null,
      ...stats,
      score: fit.score,
      scoreReasons: fit.reasons.join(' · '),
      interestCategory: fit.interest,
    }
    saved.push(await prisma.audienceVideo.upsert({
      where: { youtubeVideoId: v.id },
      create: { youtubeVideoId: v.id, ...data },
      update: data,
      include: { channel: { select: { title: true, handle: true } } },
    }))
  }
  return saved
}

/** Latest uploads of a tracked channel → scored videos (1-2 quota units) */
export async function scanChannel(channelDbId: string, max = 50) {
  const channel = await prisma.audienceChannel.findUniqueOrThrow({ where: { id: channelDbId } })
  let uploads = channel.uploadsPlaylist
  if (!uploads) {
    const [fresh] = await getChannels([channel.youtubeChannelId])
    uploads = fresh?.contentDetails?.relatedPlaylists?.uploads || null
    if (fresh) await saveChannel(fresh)
  }
  if (!uploads) throw new Error('This channel has no public uploads')
  const ids = await latestUploadIds(uploads, max)
  const saved = await saveVideos(await getVideos(ids))
  await prisma.audienceChannel.update({ where: { id: channelDbId }, data: { lastScannedAt: new Date() } })
  return saved
}

/** Paste anything: a video URL, a channel URL, an @handle, or a search phrase for channels */
export async function addFromInput(input: string, opts: { queue?: boolean; maxComments?: number } = {}) {
  const parsed = parseYouTubeInput(input)
  if (parsed.kind === 'video') {
    const videos = await saveVideos(await getVideos([parsed.id]))
    if (!videos.length) throw new Error('Video not found (private, deleted or age-restricted)')
    if (opts.queue) await queueVideos(videos.map((v) => v.id), opts.maxComments)
    return { kind: 'video' as const, videos, channels: [] }
  }
  let channels: YtChannel[] = []
  if (parsed.kind === 'channel') channels = await getChannels([parsed.id])
  else if (parsed.kind === 'handle') {
    const c = await getChannelByHandle(parsed.handle)
    channels = c ? [c] : []
  } else channels = await searchChannels(parsed.q)
  if (!channels.length) throw new Error('No channel found')
  const saved = []
  for (const c of channels) saved.push(await saveChannel(c))
  return { kind: 'channel' as const, videos: [], channels: saved }
}

export async function queueVideos(ids: string[], maxComments?: number) {
  const settings = await getAudienceSettings()
  const max = maxComments || settings.maxCommentsPerVideo
  // Finished videos can be re-queued to pick up new comments: dedupe by comment id makes it safe.
  // They restart from the top and may read `max` more new comments than they already have.
  const videos = await prisma.audienceVideo.findMany({
    where: { id: { in: ids }, status: { in: ['DISCOVERED', 'DONE', 'SKIPPED', 'ERROR'] } },
    select: { id: true, status: true, commentsCollected: true },
  })
  await prisma.$transaction(videos.map((v) => prisma.audienceVideo.update({
    where: { id: v.id },
    data: {
      status: 'QUEUED',
      lastError: null,
      nextPageToken: v.status === 'ERROR' ? undefined : null,
      maxComments: v.status === 'DISCOVERED' ? max : v.commentsCollected + max,
    },
  })))
  return videos.length
}

// ─── Campaign routing ────────────────────────────────────────────────────────

export async function routeCampaigns() {
  const campaigns = await prisma.campaign.findMany({ where: { name: { in: AUDIENCE_CAMPAIGNS.map((c) => c.name) } }, select: { id: true, name: true } })
  const byName = new Map(campaigns.map((c) => [c.name, c.id]))
  const route: Record<string, string> = {}
  for (const c of AUDIENCE_CAMPAIGNS) {
    const id = byName.get(c.name)
    if (id) for (const p of c.personas) route[p] = id
  }
  const fallback = byName.get('AI Builder — AI Enthusiasts') || byName.get('AI Builder — Founders') || null
  return { route, fallback, missing: AUDIENCE_CAMPAIGNS.filter((c) => !byName.has(c.name)).map((c) => c.name) }
}

// ─── Push to CRM ─────────────────────────────────────────────────────────────

export interface PushResult { added: number; skipped: Array<{ id: string; name: string; reason: string }>; byCampaign: Record<string, number> }

/**
 * Turn outreach-ready prospects into CRM leads in a campaign (fixed, or routed by persona).
 * The existing sequencer then sends, follows up, detects replies and stops on its own.
 */
export async function pushToCampaign(prospectIds: string[], target: { campaignId?: string; byPersona?: boolean }, userId?: string): Promise<PushResult> {
  const settings = await getAudienceSettings()
  const out: PushResult = { added: 0, skipped: [], byCampaign: {} }
  const routing = target.byPersona ? await routeCampaigns() : null
  if (!target.campaignId && !routing?.fallback && !Object.keys(routing?.route || {}).length) throw new Error('Create the AI Builder campaigns first (Audience → Campaigns), or pick a campaign')

  const prospects = await prisma.prospect.findMany({
    where: { id: { in: prospectIds } },
    include: {
      emails: true,
      lead: { select: { id: true } },
      comments: { orderBy: { score: 'desc' }, take: 1, include: { video: { include: { channel: { select: { title: true } } } } } },
    },
  })
  const campaignNames = new Map((await prisma.campaign.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]))

  for (const p of prospects) {
    const name = p.firstName ? [p.firstName, p.lastName].filter(Boolean).join(' ') : p.displayName
    const skip = (reason: string) => out.skipped.push({ id: p.id, name, reason })
    if (p.lead) { skip('already in a campaign'); continue }
    if (p.status === 'DO_NOT_CONTACT') { skip('do not contact'); continue }
    const gap = readinessGap(p, settings)
    if (gap) { skip(gap); continue }
    const email = bestEmail(p.emails, p, settings)
    if (!email) { skip('no email that passes the rules'); continue }

    const suppressed = await prisma.suppressionEntry.findFirst({ where: { OR: [{ email: email.email }, { domain: email.email.split('@')[1] }] } })
    if (suppressed) {
      await prisma.prospect.update({ where: { id: p.id }, data: { status: 'DO_NOT_CONTACT' } })
      skip('on the suppression list')
      continue
    }
    const dupe = await prisma.lead.findFirst({ where: { companyEmail: email.email }, select: { id: true } })
    if (dupe) { skip('this email is already a lead'); continue }

    const campaignId = target.campaignId || (p.persona && routing?.route[p.persona]) || routing?.fallback
    if (!campaignId) { skip('no campaign for this persona'); continue }

    const best = p.comments[0]
    const videoUrl = best ? `https://www.youtube.com/watch?v=${best.video.youtubeVideoId}&lc=${best.youtubeCommentId}` : null
    const interest = (p.interestCategory || 'GENERAL_AI') as Interest
    const lead = await prisma.lead.create({
      data: {
        firstName: p.firstName,
        lastName: p.lastName,
        fullName: p.firstName ? [p.firstName, p.lastName].filter(Boolean).join(' ') : p.displayName,
        jobTitle: p.jobTitle,
        companyName: p.company || '',
        website: p.website,
        companyEmail: email.email,
        linkedIn: p.linkedIn,
        country: p.country,
        city: p.location,
        industry: 'AI Builder',
        subIndustry: INTERESTS[interest]?.label || null,
        campaignId,
        leadSource: 'YOUTUBE',
        status: 'READY_TO_CONTACT',
        priority: p.relevance === 'HIGH' ? 'HIGH' : 'MEDIUM',
        score: p.score,
        assignedUserId: userId,
        whyThisLead: [p.reason, p.intentEvidence.length ? `Evidence: ${p.intentEvidence.join('; ')}` : ''].filter(Boolean).join('\n'),
        personalizationNotes: p.icebreaker,
        researchSummary: p.channelDescription?.slice(0, 2000) || p.bio,
        socialMediaNotes: [`https://www.youtube.com/channel/${p.youtubeChannelId}`, p.twitter, p.github && `https://github.com/${p.github}`, ...p.otherLinks.slice(0, 5)].filter(Boolean).join('\n'),
        prospectingNotes: `Intent ${p.intentScore}/100 · identity ${p.identityScore}/100 · email from ${email.source.toLowerCase().replace('_', ' ')}, ${email.status.toLowerCase()}${email.verifyMethod ? ` (${email.verifyMethod.toLowerCase()})` : ''}${email.confidence ? `, confidence ${email.confidence}` : ''}`,
        prospectId: p.id,
        sourceChannel: best?.video.channel.title,
        sourceVideo: best?.video.title,
        sourceVideoUrl: videoUrl,
        sourceComment: best?.text.slice(0, 2000),
        commentTopic: p.topic,
        interestCategory: p.interestCategory,
        persona: p.persona,
      },
    })
    await prisma.activity.create({
      data: {
        leadId: lead.id,
        userId,
        type: 'NOTE_ADDED',
        title: 'Added from YouTube audience',
        body: `${p.reason || ''}\n\nComment: "${best?.text.slice(0, 400) || ''}"`,
        metadata: { prospectId: p.id, videoUrl },
      },
    })
    await prisma.prospect.update({ where: { id: p.id }, data: { status: 'IN_CAMPAIGN' } })
    out.added++
    const cname = campaignNames.get(campaignId) || campaignId
    out.byCampaign[cname] = (out.byCampaign[cname] || 0) + 1
  }
  return out
}

// ─── Opt-out & deletion ──────────────────────────────────────────────────────

async function suppressEmails(emails: string[], reason: string) {
  for (const email of emails) {
    const exists = await prisma.suppressionEntry.findFirst({ where: { email } })
    if (!exists) await prisma.suppressionEntry.create({ data: { email, reason } })
  }
}

/** Never contact again: suppress every known address and stop any running sequence */
export async function markDoNotContact(ids: string[]) {
  const prospects = await prisma.prospect.findMany({ where: { id: { in: ids } }, include: { emails: { select: { email: true } }, lead: { select: { id: true } } } })
  await suppressEmails(prospects.flatMap((p) => p.emails.map((e) => e.email)), 'DO_NOT_CONTACT')
  const leadIds = prospects.map((p) => p.lead?.id).filter(Boolean) as string[]
  if (leadIds.length) {
    await prisma.followUpTask.updateMany({ where: { leadId: { in: leadIds }, status: 'PENDING' }, data: { status: 'CANCELLED' } })
    await prisma.lead.updateMany({ where: { id: { in: leadIds } }, data: { status: 'DO_NOT_CONTACT', nextFollowUpAt: null } })
  }
  await prisma.prospect.updateMany({ where: { id: { in: ids } }, data: { status: 'DO_NOT_CONTACT' } })
  return prospects.length
}

/**
 * Data-deletion request: remove the person, their comments and CRM lead.
 * Their addresses stay on the suppression list (the minimum needed to honour the opt-out).
 */
export async function forgetProspects(ids: string[], keepSuppressed = true) {
  const prospects = await prisma.prospect.findMany({ where: { id: { in: ids } }, include: { emails: { select: { email: true } }, lead: { select: { id: true } } } })
  if (keepSuppressed) await suppressEmails(prospects.flatMap((p) => p.emails.map((e) => e.email)), 'DO_NOT_CONTACT')
  const leadIds = prospects.map((p) => p.lead?.id).filter(Boolean) as string[]
  if (leadIds.length) await prisma.lead.deleteMany({ where: { id: { in: leadIds } } })
  const r = await prisma.prospect.deleteMany({ where: { id: { in: ids } } }) // comments + emails cascade
  return r.count
}

export async function addManualEmail(prospectId: string, email: string) {
  const e = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) throw new Error('Enter a valid email address')
  const owner = await prisma.prospectEmail.findUnique({ where: { email: e }, include: { prospect: { select: { id: true, displayName: true } } } })
  if (owner && owner.prospectId !== prospectId) throw new Error(`Already belongs to ${owner.prospect.displayName}`)
  if (owner) return owner
  const [local, domain] = e.split('@')
  const row = await prisma.prospectEmail.create({
    data: {
      prospectId, email: e, source: 'MANUAL',
      isRole: /^(info|hello|contact|admin|office|team|support|sales)$/.test(local),
      isFree: /^(gmail|googlemail|yahoo|outlook|hotmail|icloud|proton|aol|live)\./.test(domain),
    },
  })
  await updateStatus(prospectId)
  return row
}
