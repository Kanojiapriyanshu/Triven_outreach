// Audience intelligence (PRD M3/M4): turns a person's comments and profile into
//   evidence  — typed facts with a link to where they came from
//   use case  — what they're building, for whom, how far along, what's blocking them
//   fit       — how well Triven serves that (separate from intent)
//   reach     — confidence of their best sendable email
//   opportunity = intent × fit × reach × freshness — the order every queue works in
// and a "Why Triven" line that only cites evidence and the capability sheet.
// Rules run for everyone (free); the AI pass (ai.ts) can refine the shortlist.
import type { Prisma, Prospect, ProspectEmail } from '@prisma/client'
import prisma from '../prisma'
import { USE_CASES, INTEREST_TO_USE_CASE, type UseCase, type CapabilitySheet, DEFAULT_CAPABILITIES } from './usecases'
import { commentUrl, profileUrl } from './links'
import { industryPhrase } from './classify'
import { getAudienceSettings, type AudienceSettings } from './settings'
import { getCapabilities } from './capabilities'
import { isSendable } from './pipeline'

export type EvidenceType = 'SELF_BUILDING' | 'FOR_CLIENTS' | 'OWNS_BUSINESS' | 'ASKED_HOW_TO' | 'NAMED_TOOL' | 'NAMED_BLOCKER'
  | 'REPEAT_ENGAGEMENT' | 'OWN_AI_CONTENT' | 'SITE_OFFERS_AI' | 'JOB_TITLE' | 'BUDGET_SIGNAL' | 'NEGATIVE'

export interface EvidenceDraft { type: EvidenceType; weight: number; text: string; sourceUrl?: string | null; sourceKind: string; observedAt?: Date | null }

type CommentIn = {
  id: string; youtubeCommentId: string; text: string; signals: string[]; relevance: string; score: number; flaggedInauthentic: boolean
  publishedAt: Date | null; createdAt: Date
  video: { title: string; platform: string; youtubeVideoId: string; url: string | null; channel: { title: string; youtubeChannelId: string } }
}

// Comment signal (classify.ts) → evidence type + weight
const SIGNAL_EVIDENCE: Record<string, { type: EvidenceType; weight: number; label: string }> = {
  building_now: { type: 'SELF_BUILDING', weight: 18, label: 'Already building' },
  agency:       { type: 'FOR_CLIENTS', weight: 18, label: 'Builds for clients' },
  consultant:   { type: 'FOR_CLIENTS', weight: 12, label: 'Consultant' },
  freelance:    { type: 'FOR_CLIENTS', weight: 8, label: 'Freelancer' },
  business:     { type: 'OWNS_BUSINESS', weight: 15, label: 'Runs a business' },
  founder:      { type: 'OWNS_BUSINESS', weight: 15, label: 'Founder' },
  build_intent: { type: 'ASKED_HOW_TO', weight: 10, label: 'Asked how to build it' },
  pain:         { type: 'NAMED_BLOCKER', weight: 10, label: 'Named a problem' },
  money:        { type: 'BUDGET_SIGNAL', weight: 8, label: 'Talks pricing / revenue' },
  developer:    { type: 'SELF_BUILDING', weight: 8, label: 'Writes code' },
  tech_job:     { type: 'JOB_TITLE', weight: 5, label: 'Works in tech' },
}
const SIGNAL_RE: Record<string, RegExp> = {
  building_now: /\b(i('?m| am)|we('?re| are)) (currently )?(building|working on|creating|developing|launching)|\b(built|launched|shipped)\b|\bmy (project|app|saas|startup|agent|bot|workflow|mvp|tool|product)\b/i,
  agency: /\b(agency|clients?|white.?label|resell)/i,
  consultant: /\bconsult/i,
  freelance: /\b(freelanc|upwork|fiverr)/i,
  business: /\b(my|our) (own )?(business|company|clinic|practice|shop|store|restaurant|firm|salon|team|customers?)|\bi (own|run|manage)\b/i,
  founder: /\b(founder|ceo|startup|saas|entrepreneur|solopreneur)/i,
  build_intent: /\b(how (do|can|would|should)|is (it|there a way|this) possible|can (it|this|you|i|we)|does (it|this))\b/i,
  pain: /\b(struggl\w*|stuck|can'?t figure|doesn'?t work|keeps? (failing|breaking)|fail\w*|errors?|broken|hard to|difficult|too (complex|complicated|expensive|slow)|frustrat\w*|hallucinat\w*|latency|slow)\b/i,
  money: /\b(pricing|charge|price|cost|revenue|monetiz\w*|paying|per month|mrr|roi|\$\d+)/i,
  developer: /\b(api|python|javascript|typescript|langchain|langgraph|crewai|rag|webhooks?|docker|deploy\w*|sdk|mcp)\b/i,
  tech_job: /\b(at work|my (boss|manager|employer|job)|engineer|developer|product manager)\b/i,
}
const NEGATIVE_RE = /\b(i'?m (a |just a )?(student|beginner)|for (my )?(school|homework|thesis|class)|just curious|just learning|no idea what|will ai (take|replace)|scared|job loss)\b/i
const RESEARCH_RE = /\b(fine.?tun\w*|train(ing)? (a |my |our )?(own )?(model|llm)|pytorch|tensorflow|research paper|pre.?train\w*|foundation model)\b/i
const TOOL_RE = /\b(n8n|make\.com|zapier|vapi|retell|bland(?:\.ai)?|voiceflow|botpress|flowise|langchain|langgraph|crewai|gohighlevel|ghl|twilio|elevenlabs|synthflow|relevance ai|airtable|supabase)\b/gi
const SHIPPED_RE = /\b(launched|shipped|in production|live (now|with)|went live|deployed (it|to)|my (users|customers) (use|love))\b/i
const SELLING_RE = /\b(sell(ing)? (this|these|it|them) to|my clients (pay|use|want)|charg(e|ing) (my )?clients|client (projects?|work)|for (my|our) clients|white.?label)\b/i

/** The sentence around the first match, trimmed to fit a quote */
function quoteAround(text: string, re: RegExp, max = 150) {
  const clean = text.replace(/\s+/g, ' ').trim()
  const m = clean.match(new RegExp(re.source, re.flags.replace('g', '')))
  if (!m || m.index === undefined) return clean.slice(0, max)
  const sentences = clean.split(/(?<=[.!?])\s+/)
  let pos = 0
  for (const s of sentences) {
    if (m.index >= pos && m.index < pos + s.length + 1) {
      if (s.length <= max) return s
      // Long sentence: a window around the match, snapped to whole words
      const at = m.index - pos
      const words = s.split(/\s+/)
      let start = 0, count = 0
      for (let i = 0; i < words.length; i++) { if (count + words[i].length + 1 > at - 50) { start = i; break } count += words[i].length + 1 }
      let out = ''
      for (const w of words.slice(start)) { if ((out + ' ' + w).length > max) break; out = out ? `${out} ${w}` : w }
      return `${start > 0 ? '…' : ''}${out}${start + out.split(' ').length < words.length ? '…' : ''}`
    }
    pos += s.length + 1
  }
  return clean.slice(0, max)
}

const urlOf = (c: CommentIn) => commentUrl(c.video.platform, c.video.youtubeVideoId, c.youtubeCommentId, c.video.url)

export function buildEvidence(p: Pick<Prospect, 'platform' | 'youtubeChannelId' | 'profileUrl' | 'ownChannelAi' | 'ownChannelSummary' | 'jobTitle' | 'company' | 'bio' | 'channelDescription'>, comments: CommentIn[]): EvidenceDraft[] {
  const real = comments.filter((c) => c.relevance !== 'SPAM' && !c.flaggedInauthentic)
  const out: EvidenceDraft[] = []
  const seen = new Set<string>()
  // Strongest comment for each signal becomes one evidence item, quoted
  for (const [signal, ev] of Object.entries(SIGNAL_EVIDENCE)) {
    const c = [...real].filter((x) => x.signals.includes(signal)).sort((a, b) => b.score - a.score)[0]
    if (!c || seen.has(ev.type + signal)) continue
    seen.add(ev.type + signal)
    out.push({ type: ev.type, weight: ev.weight, text: `${ev.label}: "${quoteAround(c.text, SIGNAL_RE[signal])}"`, sourceUrl: urlOf(c), sourceKind: 'COMMENT', observedAt: c.publishedAt || c.createdAt })
  }
  const tools = [...new Set(real.flatMap((c) => [...c.text.matchAll(TOOL_RE)].map((m) => m[1].toLowerCase())))]
  if (tools.length) {
    const c = real.find((x) => new RegExp(TOOL_RE.source, 'i').test(x.text))!
    out.push({ type: 'NAMED_TOOL', weight: 5, text: `Uses ${tools.slice(0, 3).join(', ')}`, sourceUrl: urlOf(c), sourceKind: 'COMMENT', observedAt: c.publishedAt })
  }
  const videos = new Set(real.map((c) => c.video.youtubeVideoId)).size
  const channels = new Set(real.map((c) => c.video.channel.youtubeChannelId)).size
  if (real.length >= 2) out.push({ type: 'REPEAT_ENGAGEMENT', weight: Math.min(12, 4 + real.length * 2), text: `${real.length} comments on ${videos} video${videos === 1 ? '' : 's'}${channels > 1 ? ` across ${channels} channels` : ''}`, sourceKind: 'COMMENT' })
  if (p.ownChannelAi) out.push({ type: 'OWN_AI_CONTENT', weight: 15, text: `Own channel: ${p.ownChannelSummary || 'publishes AI/automation content'}`, sourceUrl: profileUrl(p), sourceKind: 'PROFILE' })
  if (p.jobTitle) out.push({ type: 'JOB_TITLE', weight: /founder|ceo|owner|director|head/i.test(p.jobTitle) ? 12 : 6, text: `${p.jobTitle}${p.company ? ` at ${p.company}` : ''}`, sourceUrl: profileUrl(p), sourceKind: 'PROFILE' })
  const bio = `${p.bio || ''} ${p.channelDescription || ''}`
  if (/\b(ai|automation|agents?|chatbots?|voice ai)\b/i.test(bio) && /\b(agency|services?|we (build|help)|i (build|help)|clients?)\b/i.test(bio)) {
    out.push({ type: 'SITE_OFFERS_AI', weight: 12, text: `Offers AI services: "${quoteAround(bio, /\b(agency|services?|we (build|help)|i (build|help)|clients?)\b/i, 120)}"`, sourceUrl: profileUrl(p), sourceKind: 'PROFILE' })
  }
  const neg = real.find((c) => NEGATIVE_RE.test(c.text))
  if (neg) out.push({ type: 'NEGATIVE', weight: -15, text: `"${quoteAround(neg.text, NEGATIVE_RE)}"`, sourceUrl: urlOf(neg), sourceKind: 'COMMENT', observedAt: neg.publishedAt })
  return out
}

// ─── Use case ────────────────────────────────────────────────────────────────

export interface UseCaseFields { useCase: UseCase; useCaseDetail: string | null; forWhom: string; vertical: string | null; buildStage: string; blocker: string | null }

export function inferUseCase(texts: string[], signals: Set<string>, interest?: string | null, topic?: string | null): UseCaseFields {
  const all = texts.join(' \n ')
  const scores = (Object.keys(USE_CASES) as UseCase[]).filter((k) => k !== 'UNKNOWN').map((k) => ({ k, n: (all.match(new RegExp(USE_CASES[k].re.source, 'gi')) || []).length }))
  // Specific use cases beat the generic "agent/workflow" ones on ties
  const generic = new Set<UseCase>(['CUSTOM_WORKFLOW', 'OPERATIONS_AUTOMATION'])
  scores.sort((a, b) => b.n - a.n || Number(generic.has(a.k)) - Number(generic.has(b.k)))
  const useCase = scores[0].n > 0 ? scores[0].k : (INTEREST_TO_USE_CASE[interest || ''] || 'UNKNOWN')

  const forWhom = signals.has('agency') || signals.has('consultant') || signals.has('freelance') || SELLING_RE.test(all) ? 'CLIENTS'
    : signals.has('business') || signals.has('founder') ? 'SELF'
    : signals.has('tech_job') ? 'EMPLOYER' : 'UNKNOWN'
  const buildStage = SELLING_RE.test(all) ? 'SELLING' : SHIPPED_RE.test(all) ? 'SHIPPED' : signals.has('building_now') ? 'BUILDING' : 'EXPLORING'
  const painText = texts.find((t) => SIGNAL_RE.pain.test(t))
  // A blocker is only kept when it reads as a clean phrase (no cut-off fragments)
  const rawBlocker = painText ? quoteAround(painText, SIGNAL_RE.pain, 100).replace(/^["']|["']$/g, '') : ''
  const blocker = rawBlocker && !rawBlocker.includes('…') && rawBlocker.length <= 100 ? rawBlocker : null
  const vertical = industryPhrase(all) || null
  return { useCase, useCaseDetail: topic || null, forWhom, vertical, buildStage, blocker }
}

// ─── Fit ─────────────────────────────────────────────────────────────────────

export function computeFit(u: UseCaseFields, ctx: { signals: Set<string>; texts: string[]; evidence: EvidenceDraft[]; persona?: string | null; hasBusinessContext: boolean }, caps: CapabilitySheet) {
  const reasons: string[] = []
  let fit = 0
  const add = (n: number, why: string) => { fit += n; reasons.push(`${n > 0 ? '+' : ''}${n} ${why}`) }
  const all = ctx.texts.join(' ')
  if (u.useCase !== 'UNKNOWN' && caps.supported.includes(u.useCase)) add(30, `${USE_CASES[u.useCase].label} is something Triven builds`)
  else if (u.useCase !== 'UNKNOWN') add(10, `${USE_CASES[u.useCase].label} (not a core Triven use case)`)
  if (u.forWhom === 'CLIENTS') add(20, 'builds for clients: one platform, many deployments')
  if (u.blocker && caps.removes && new RegExp(`\\b(${caps.removes})`, 'i').test(u.blocker)) add(20, `blocker Triven removes ("${u.blocker.slice(0, 50)}")`)
  if (ctx.hasBusinessContext) add(15, 'business context (owns a business, company or title)')
  if (u.buildStage === 'BUILDING' || u.buildStage === 'SELLING') add(10, `stage: ${u.buildStage.toLowerCase()}`)
  if (ctx.evidence.some((e) => e.type === 'NAMED_TOOL')) add(5, 'uses tools Triven replaces or complements')
  if (RESEARCH_RE.test(all)) add(-30, 'model training / ML research: not what Triven is for')
  if (ctx.evidence.some((e) => e.type === 'NEGATIVE')) add(-20, 'student / just curious')
  return { fit: Math.max(0, Math.min(100, fit)), reasons }
}

// ─── Email confidence (PRD R4.4) ─────────────────────────────────────────────

const PUBLISHED = ['CHANNEL', 'CHANNEL_VIDEO', 'WEBSITE', 'LINK_PAGE', 'MANUAL', 'LISTING']

export function emailConfidence(e: Pick<ProspectEmail, 'email' | 'source' | 'status' | 'confidence' | 'isRole' | 'isFree'>, p: { website?: string | null; firstName?: string | null; lastName?: string | null; intentScore: number }) {
  if (e.status === 'INVALID') return { score: 0, reasons: ['invalid'] }
  const reasons: string[] = []
  let s = 0
  if (PUBLISHED.includes(e.source)) { s += 45; reasons.push('published by them') }
  else if (e.source === 'HUNTER' || e.source === 'APOLLO') { const n = Math.round((e.confidence || 50) * 0.4); s += n; reasons.push(`finder ${e.confidence ?? '?'}%`) }
  else { s += 30; reasons.push(e.source === 'PATTERN' ? 'verified guess' : 'found by search') }
  if (e.status === 'VERIFIED') { s += 40; reasons.push('mailbox verified') }
  else if (e.status === 'UNKNOWN') { s += 10; reasons.push('domain accepts mail') }
  else reasons.push('catch-all domain')
  const domain = e.email.split('@')[1]
  const site = (p.website || '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0]
  if (site && (domain === site || domain.endsWith(`.${site}`) || site.endsWith(`.${domain}`))) { s += 10; reasons.push('matches their website') }
  const local = e.email.split('@')[0].toLowerCase()
  if (p.firstName && local.includes(p.firstName.toLowerCase())) { s += 5; reasons.push('matches their name') }
  if (e.isRole) { s -= 10; reasons.push('role inbox') }
  if (e.isFree) {
    const offered = PUBLISHED.includes(e.source) && p.intentScore >= 80
    if (!offered) { s -= 15; reasons.push('personal free-mail') }
  }
  return { score: Math.max(0, Math.min(100, s)), reasons }
}

// ─── Freshness & opportunity ────────────────────────────────────────────────

export function freshness(lastEngagedAt?: Date | null) {
  if (!lastEngagedAt) return 0.4
  const days = (Date.now() - lastEngagedAt.getTime()) / 86_400_000
  return days <= 14 ? 1 : days <= 60 ? 0.8 : days <= 180 ? 0.6 : 0.4
}

export function opportunity(intent: number, fit: number, reach: number, lastEngagedAt?: Date | null) {
  return Math.round((intent * fit * reach) / 10_000 * freshness(lastEngagedAt))
}

// ─── Why Triven (rules; the AI pass may rewrite it with citations) ───────────

export function whyTrivenRules(u: UseCaseFields, evidence: Array<EvidenceDraft & { ref: string }>, caps: CapabilitySheet) {
  if (u.useCase === 'UNKNOWN') return { whyTriven: null, angle: null, cites: [] as string[] }
  const cite = (t: EvidenceType[]) => evidence.filter((e) => t.includes(e.type)).slice(0, 1)
  const who = cite(['FOR_CLIENTS', 'OWNS_BUSINESS', 'SELF_BUILDING'])
  const blocker = cite(['NAMED_BLOCKER'])
  const subject = u.forWhom === 'CLIENTS' ? `Builds ${USE_CASES[u.useCase].label.toLowerCase()}s for clients` : u.forWhom === 'SELF' ? `Wants ${USE_CASES[u.useCase].short} for their own business` : `Interested in ${USE_CASES[u.useCase].short}`
  const vertical = u.vertical ? ` (${u.vertical})` : ''
  const line = caps.lines[u.useCase] || `lets you build ${USE_CASES[u.useCase].short} by describing it instead of building everything from scratch`
  const refs = [...who, ...blocker].map((e) => e.ref)
  const whyTriven = `${subject}${vertical}${who[0] ? ` [${who[0].ref}]` : ''}${u.blocker && blocker[0] ? `, stuck on "${u.blocker.slice(0, 60)}" [${blocker[0].ref}]` : ''}. ${caps.product} ${line}.`
  const offer = caps.templateLinks[u.useCase] ? 'the ready-made template' : 'a ready-made template'
  const angle = `Offer ${offer} for ${USE_CASES[u.useCase].short}${u.vertical ? ` for ${u.vertical}` : ''}${u.forWhom === 'CLIENTS' ? ' they can deploy for their clients' : ''}${u.blocker ? `, and address "${u.blocker.slice(0, 40)}"` : ''}.`
  return { whyTriven, angle, cites: refs }
}

// ─── Discovery stage (PRD R4.1) ──────────────────────────────────────────────

export function discoveryStage(p: Pick<Prospect, 'status' | 'relevance' | 'enrichedAt' | 'identityScore' | 'inauthentic'> & { emails: Array<Pick<ProspectEmail, 'status' | 'isPrimary'>>; ready: boolean; hasLead: boolean }, minIdentity: number) {
  if (p.status === 'DO_NOT_CONTACT') return 'DO_NOT_CONTACT'
  if (p.inauthentic) return 'SUSPECTED_INAUTHENTIC'
  if (p.hasLead) return 'CONTACTED'
  if (p.ready) return 'READY'
  if (p.relevance === 'LOW' || p.relevance === 'SPAM') return p.enrichedAt ? 'NOT_QUALIFIED' : 'COLLECTED'
  if (!p.enrichedAt) return 'QUALIFIED'
  const live = p.emails.filter((e) => e.status !== 'INVALID')
  if (live.some((e) => e.status === 'VERIFIED')) return 'VERIFIED'
  if (live.length) return 'EMAIL_CANDIDATES'
  if (p.identityScore >= minIdentity) return 'IDENTITY_CONFIRMED'
  return p.status === 'NO_CONTACT' ? 'UNREACHABLE' : 'RESEARCHED'
}

export { getCapabilities, saveCapabilities } from './capabilities'

// ─── Recompute (called after collection, research, verification, AI review) ──

/**
 * Rebuild rule evidence and every derived field for these people. AI- and hand-made evidence
 * and a use case set by AI or by hand are kept; rule-made ones are replaced.
 */
export async function recomputeIntelligence(ids: string[], ctx?: { settings?: AudienceSettings; caps?: CapabilitySheet; isReady?: (id: string) => boolean }) {
  if (!ids.length) return 0
  const settings = ctx?.settings || await getAudienceSettings()
  const caps = ctx?.caps || await getCapabilities()
  let n = 0
  for (let i = 0; i < ids.length; i += 40) {
    const people = await prisma.prospect.findMany({
      where: { id: { in: ids.slice(i, i + 40) } },
      include: {
        emails: true,
        lead: { select: { id: true } },
        evidence: { where: { createdBy: { not: 'RULES' } } },
        comments: {
          orderBy: { score: 'desc' }, take: 40,
          select: { id: true, youtubeCommentId: true, text: true, signals: true, relevance: true, score: true, flaggedInauthentic: true, publishedAt: true, createdAt: true, video: { select: { title: true, platform: true, youtubeVideoId: true, url: true, channel: { select: { title: true, youtubeChannelId: true } } } } },
        },
      },
    })
    for (const p of people) {
      const drafts = buildEvidence(p, p.comments)
      const real = p.comments.filter((c) => c.relevance !== 'SPAM' && !c.flaggedInauthentic)
      const texts = [...real.map((c) => c.text), p.bio || '', p.channelDescription || ''].filter(Boolean)
      const signals = new Set(real.flatMap((c) => c.signals))
      const keepUseCase = p.useCaseSource === 'AI' || p.useCaseSource === 'MANUAL'
      const u: UseCaseFields = keepUseCase && p.useCase
        ? { useCase: p.useCase as UseCase, useCaseDetail: p.useCaseDetail, forWhom: p.forWhom || 'UNKNOWN', vertical: p.vertical, buildStage: p.buildStage || 'EXPLORING', blocker: p.blocker }
        : inferUseCase(texts, signals, p.interestCategory, p.topic)
      const allEvidence = [...drafts, ...p.evidence.map((e) => ({ ...e, type: e.type as EvidenceType }))]
      const { fit, reasons } = computeFit(u, { signals, texts, evidence: allEvidence, persona: p.persona, hasBusinessContext: !!(p.company || p.website || p.jobTitle || signals.has('business') || signals.has('founder')) }, caps)

      // Email confidence; reachability = best sendable address (existing readiness rules decide "sendable")
      const conf = p.emails.map((e) => ({ e, ...emailConfidence(e, p) }))
      const ready = ctx?.isReady ? ctx.isReady(p.id) : p.status === 'READY_TO_CONTACT' || p.status === 'IN_CAMPAIGN'
      const sendable = conf.filter((c) => isSendable(c.e, p, settings))
      const reach = sendable.length ? Math.max(...sendable.map((c) => c.score)) : 0
      const lastEngagedAt = real.reduce<Date | null>((m, c) => { const d = c.publishedAt || c.createdAt; return !m || d > m ? d : m }, null)
      const opp = opportunity(p.intentScore, fit, reach, lastEngagedAt)

      const refd = allEvidence.map((e, k) => ({ ...e, ref: `E${k + 1}` }))
      const why = p.useCaseSource === 'AI' && p.whyTriven ? { whyTriven: p.whyTriven, angle: p.outreachAngle, cites: [] as string[] } : whyTrivenRules(u, refd, caps)
      const first = [...p.comments].sort((a, b) => (a.publishedAt || a.createdAt).getTime() - (b.publishedAt || b.createdAt).getTime())[0]
      const stage = discoveryStage({ ...p, ready, hasLead: !!p.lead }, settings.minIdentity)

      await prisma.$transaction([
        prisma.prospectEvidence.deleteMany({ where: { prospectId: p.id, createdBy: 'RULES' } }),
        prisma.prospectEvidence.createMany({ data: drafts.map((d) => ({ prospectId: p.id, type: d.type, weight: d.weight, text: d.text.slice(0, 300), sourceUrl: d.sourceUrl || null, sourceKind: d.sourceKind, observedAt: d.observedAt || null, createdBy: 'RULES' })) }),
        // Finder confidence stays as the finder reported it; our composite is recomputed on read
        ...conf.map((c) => prisma.prospectEmail.update({ where: { id: c.e.id }, data: { confidenceReasons: [`${c.score}`, ...c.reasons] } })),
        prisma.prospect.update({
          where: { id: p.id },
          data: {
            ...(keepUseCase ? {} : { useCase: u.useCase, useCaseDetail: u.useCaseDetail, forWhom: u.forWhom, vertical: u.vertical, buildStage: u.buildStage, blocker: u.blocker, useCaseSource: 'RULES' }),
            fitScore: fit, fitReasons: reasons, reachability: reach, opportunityScore: opp,
            whyTriven: why.whyTriven, outreachAngle: why.angle,
            // Citations carry their own text + link, so "[E2]" stays meaningful whatever order evidence is shown in
            ...(p.useCaseSource === 'AI' ? {} : { aiCitations: refd.filter((e) => why.cites.includes(e.ref)).map((e) => ({ ref: e.ref, text: e.text, url: e.sourceUrl || null })) as unknown as Prisma.InputJsonValue }),
            lastEngagedAt, discoveryStage: stage,
            ...(!p.firstContentId && first ? { firstSourcePlatform: first.video.platform, firstContainerId: first.video.channel.youtubeChannelId, firstContentId: first.video.youtubeVideoId, firstEngagementId: first.youtubeCommentId } : {}),
          },
        }),
      ])
      n++
    }
  }
  return n
}
