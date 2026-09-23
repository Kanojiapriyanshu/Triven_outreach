import prisma from '../prisma'
import { quotaUsage, youtubeConfigured } from './youtube'
import { aiConfigured } from './ai'
import { verifierProvider } from './verify'
import { pipelineBacklog, readinessBreakdown } from './pipeline'
import { searchProvider } from './identity'
import { finderProviders } from './finders'
import { hunterAccount } from './hunter'

const n = (x: unknown) => Number(x || 0)

export async function audienceOverview() {
  const lead = (where: object) => prisma.prospect.count({ where: { lead: { is: where } } })
  const [
    comments, channels, videos, prospects, relevant, high, enriched, profiles, withEmail, verified, ready, inCampaign,
    contacted, followUps, replied, interested, meetings, won, emailsTotal, emailsInvalid, emailsChecked, dnc,
  ] = await Promise.all([
    prisma.audienceComment.count(),
    prisma.audienceChannel.count(),
    prisma.audienceVideo.count({ where: { status: { not: 'DISCOVERED' } } }),
    prisma.prospect.count(),
    prisma.prospect.count({ where: { relevance: { in: ['HIGH', 'MEDIUM'] } } }),
    prisma.prospect.count({ where: { relevance: 'HIGH' } }),
    prisma.prospect.count({ where: { enrichedAt: { not: null } } }),
    prisma.prospect.count({ where: { enrichedAt: { not: null }, OR: [{ website: { not: null } }, { linkedIn: { not: null } }, { github: { not: null } }, { company: { not: null } }] } }),
    prisma.prospect.count({ where: { emails: { some: { status: { not: 'INVALID' } } } } }),
    prisma.prospect.count({ where: { emails: { some: { status: 'VERIFIED' } } } }),
    prisma.prospect.count({ where: { status: 'READY_TO_CONTACT' } }),
    prisma.prospect.count({ where: { lead: { isNot: null } } }),
    lead({ firstEmailSentAt: { not: null } }),
    lead({ followUp1SentAt: { not: null } }),
    lead({ hasReplied: true }),
    lead({ isInterested: true }),
    lead({ meetingBooked: true }),
    lead({ hasSale: true }),
    prisma.prospectEmail.count(),
    prisma.prospectEmail.count({ where: { status: 'INVALID' } }),
    prisma.prospectEmail.count({ where: { checkedAt: { not: null } } }),
    prisma.prospect.count({ where: { status: 'DO_NOT_CONTACT' } }),
  ])

  const [byInterest, byPersona, byRegion, byRelevance, byCountry, byPlatform] = await Promise.all([
    prisma.prospect.groupBy({ by: ['interestCategory'], where: { relevance: { in: ['HIGH', 'MEDIUM'] } }, _count: true }),
    prisma.prospect.groupBy({ by: ['persona'], where: { relevance: { in: ['HIGH', 'MEDIUM'] } }, _count: true }),
    prisma.prospect.groupBy({ by: ['region'], where: { relevance: { in: ['HIGH', 'MEDIUM'] } }, _count: true }),
    prisma.prospect.groupBy({ by: ['relevance'], _count: true }),
    prisma.prospect.groupBy({ by: ['country'], where: { relevance: { in: ['HIGH', 'MEDIUM'] } }, _count: true, orderBy: { _count: { country: 'desc' } }, take: 15 }),
    prisma.prospect.groupBy({ by: ['platform'], where: { relevance: { in: ['HIGH', 'MEDIUM'] } }, _count: true }),
  ])

  // Source performance: which channels' audiences actually turn into conversations
  const sources = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT ch.id, ch.title, ch.handle, ch."thumbnailUrl", ch."subscriberCount",
      COUNT(DISTINCT v.id) FILTER (WHERE v.status <> 'DISCOVERED') AS videos,
      COUNT(c.id) AS comments,
      COUNT(DISTINCT p.id) AS prospects,
      COUNT(DISTINCT p.id) FILTER (WHERE p.relevance IN ('HIGH','MEDIUM')) AS relevant,
      COUNT(DISTINCT p.id) FILTER (WHERE EXISTS (SELECT 1 FROM prospect_emails e WHERE e."prospectId" = p.id AND e.status <> 'INVALID')) AS "withEmail",
      COUNT(DISTINCT p.id) FILTER (WHERE EXISTS (SELECT 1 FROM prospect_emails e WHERE e."prospectId" = p.id AND e.status = 'VERIFIED')) AS verified,
      COUNT(DISTINCT l.id) FILTER (WHERE l."firstEmailSentAt" IS NOT NULL) AS contacted,
      COUNT(DISTINCT l.id) FILTER (WHERE l."hasReplied") AS replied,
      COUNT(DISTINCT l.id) FILTER (WHERE l."isInterested") AS interested,
      COUNT(DISTINCT l.id) FILTER (WHERE l."meetingBooked") AS meetings
    FROM audience_channels ch
    LEFT JOIN audience_videos v ON v."channelId" = ch.id
    LEFT JOIN audience_comments c ON c."videoId" = v.id
    LEFT JOIN prospects p ON p.id = c."prospectId"
    LEFT JOIN leads l ON l."prospectId" = p.id
    GROUP BY ch.id
    ORDER BY COUNT(DISTINCT p.id) FILTER (WHERE p.relevance IN ('HIGH','MEDIUM')) DESC, ch.title
    LIMIT 100`

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null)
  const [quota, backlog, hunter, readiness] = await Promise.all([quotaUsage(), pipelineBacklog(), hunterAccount().catch(() => null), readinessBreakdown()])

  return {
    config: {
      youtube: youtubeConfigured(),
      ai: aiConfigured(),
      verifier: verifierProvider(),
      search: searchProvider(),
      finders: finderProviders(),
    },
    hunter,
    readiness,
    quota,
    backlog,
    funnel: { comments, prospects, relevant, high, enriched, withEmail, verified, ready, inCampaign, contacted, followUps, replied, interested, meetings, won },
    quality: {
      relevantPct: pct(relevant, prospects),
      profilePct: pct(profiles, enriched),
      emailFoundPct: pct(withEmail, enriched),
      verifiedPct: pct(verified, withEmail),
      // comments that didn't create a new person because the author was already known
      repeatMerged: Math.max(0, comments - prospects),
      invalidEmailPct: pct(emailsInvalid, emailsChecked),
      emailsTotal,
      dnc,
    },
    outreach: {
      replyPct: pct(replied, contacted),
      interestedPct: pct(interested, contacted),
      meetingPct: pct(meetings, contacted),
      wonPct: pct(won, contacted),
    },
    counts: { channels, videos },
    byInterest: byInterest.map((r) => ({ key: r.interestCategory || 'UNKNOWN', count: r._count })),
    byPersona: byPersona.map((r) => ({ key: r.persona || 'UNKNOWN', count: r._count })),
    byRegion: byRegion.map((r) => ({ key: r.region || 'UNKNOWN', count: r._count })),
    byRelevance: byRelevance.map((r) => ({ key: r.relevance, count: r._count })),
    byCountry: byCountry.map((r) => ({ key: r.country || 'UNKNOWN', count: r._count })),
    byPlatform: byPlatform.map((r) => ({ key: r.platform, count: r._count })),
    sources: sources.map((s) => ({
      id: String(s.id), title: String(s.title), handle: s.handle as string | null, thumbnailUrl: s.thumbnailUrl as string | null,
      subscriberCount: n(s.subscriberCount), videos: n(s.videos), comments: n(s.comments), prospects: n(s.prospects),
      relevant: n(s.relevant), withEmail: n(s.withEmail), verified: n(s.verified), contacted: n(s.contacted),
      replied: n(s.replied), interested: n(s.interested), meetings: n(s.meetings),
    })),
  }
}
