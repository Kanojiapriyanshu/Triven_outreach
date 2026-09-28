// Lead Finder pipeline. Like the audience pipeline, every step works in small batches against a
// deadline so it fits a 60 s serverless call and continues on the next worker tick.
//
//   search   → Google Places / OpenStreetMap, page by page, location by location
//   filter   → off-niche results, closed businesses, chains, rating/review floors dropped
//   research → website + web search + Hunter + verified guesses (lib/finder/research.ts)
//   score    → fit for an AI receptionist (call value, hours gaps, reviews, owner, email quality)
//   status   → READY when there's an address we're allowed to use
import type { Business, BusinessEmail, LeadSearch, Prisma } from '@prisma/client'
import prisma from '../prisma'
import { googleTextSearch, osmSearch, formatHours, hoursFacts, PlacesError, type PlaceResult } from './places'
import { nicheOf, CHAIN_NAMES, type Niche } from './niches'
import { getFinderSettings, type FinderSettings } from './settings'
import { researchBusiness, ownDomain } from './research'
import { emailTraits } from '../audience/verify'
import { hostOf } from '../audience/enrich'
import { SEQUENCE_LIBRARY } from '../sequence-library'
import { notify } from '../notify'

const left = (deadline: number) => deadline - Date.now()

// ─── 1. Search ───────────────────────────────────────────────────────────────

interface Cursor { loc: number; token?: string | null; pages?: number; retries?: number }

/** Run (or continue) one search until it's done or the time is up */
export async function runSearch(searchId: string, deadline: number) {
  const search = await prisma.leadSearch.findUnique({ where: { id: searchId } })
  if (!search || ['DONE', 'CANCELLED'].includes(search.status)) return search
  const s = await getFinderSettings()
  const niche = nicheOf(search.niche)
  const cursor: Cursor = (search.cursor as unknown as Cursor) || { loc: 0 }
  const locations = search.locations.length ? search.locations : ['']
  await prisma.leadSearch.update({ where: { id: search.id }, data: { status: 'RUNNING', startedAt: search.startedAt || new Date() } })

  const counts = { found: 0, added: 0, duplicates: 0, filtered: 0, apiCalls: 0 }
  let error: string | null = null
  let fatal = false
  try {
    while (cursor.loc < locations.length && left(deadline) > 12_000) {
      const location = locations[cursor.loc]
      let places: PlaceResult[] = []
      let next: string | null = null
      if (search.provider === 'OSM') {
        // No ranking on OSM: the ones we can actually reach (site / email / phone) first
        const all = await osmSearch(niche?.osm || [], location, search.country, Math.min(search.maxPerPlace * 4, 400))
        const reach = (p: PlaceResult) => (p.email ? 4 : 0) + (p.website ? 2 : 0) + (p.phone ? 1 : 0)
        places = all.sort((a, b) => reach(b) - reach(a)).slice(0, search.maxPerPlace)
        counts.apiCalls++
      } else {
        const res = await googleTextSearch(`${search.query}${location ? ` in ${location}` : ''}`, { pageToken: cursor.token, regionCode: search.country })
        counts.apiCalls++
        places = res.places
        next = res.nextPageToken
      }
      counts.found += places.length
      const r = await savePlaces(places, search, niche, s)
      counts.added += r.added; counts.duplicates += r.duplicates; counts.filtered += r.filtered

      cursor.pages = (cursor.pages || 0) + 1
      const perPage = search.provider === 'OSM' ? Infinity : 20
      if (next && cursor.pages * perPage < search.maxPerPlace) cursor.token = next
      else { cursor.loc++; cursor.token = null; cursor.pages = 0 }
    }
  } catch (err) {
    error = (err as Error).message
    // Busy servers and timeouts get retried on the next run; a missing key or the monthly cap don't
    cursor.retries = (cursor.retries || 0) + 1
    fatal = (err instanceof PlacesError && (err.code === 'CAP' || err.code === 'KEY')) || cursor.retries > 3
    if (err instanceof PlacesError && err.code === 'CAP') {
      await notify({ type: 'QUOTA', title: 'Google monthly cap reached', body: error, href: '/finder?settings=1', group: 'google-cap', cooldownHours: 24 })
    }
  }

  const done = cursor.loc >= locations.length
  const updated = await prisma.leadSearch.update({
    where: { id: search.id },
    data: {
      cursor: cursor as unknown as Prisma.InputJsonValue,
      found: { increment: counts.found }, added: { increment: counts.added }, duplicates: { increment: counts.duplicates },
      filtered: { increment: counts.filtered }, apiCalls: { increment: counts.apiCalls },
      status: fatal ? 'ERROR' : done ? 'DONE' : 'RUNNING',
      lastError: error, finishedAt: done || fatal ? new Date() : null,
    },
  })
  if (done && !error) {
    await notify({
      type: 'SEARCH_DONE',
      title: `Search finished: ${updated.added} new ${niche?.label.toLowerCase() || `"${search.query}"`}`,
      body: `${locations.filter(Boolean).join(', ') || 'Anywhere'} · ${updated.found} results, ${updated.duplicates} already known, ${updated.filtered} filtered out. Emails are being researched now.`,
      href: `/finder?search=${search.id}`,
    })
  }
  return updated
}

function nicheMatch(p: PlaceResult, niche: Niche | null) {
  if (!niche) return true
  if (p.source === 'OSM') return true // the tags already are the niche
  return p.types.some((t) => niche.types.includes(t)) || !!niche.nameHint?.test(p.name)
}

async function savePlaces(places: PlaceResult[], search: LeadSearch, niche: Niche | null, s: FinderSettings) {
  const out = { added: 0, duplicates: 0, filtered: 0 }
  if (!places.length) return out
  const known = new Set((await prisma.business.findMany({ where: { placeId: { in: places.map((p) => p.placeId) } }, select: { placeId: true } })).map((b) => b.placeId))
  // Same website on 3+ listings in one batch = a chain or franchise
  const domainCount = new Map<string, number>()
  for (const p of places) { const d = ownDomain(p.website); if (d) domainCount.set(d, (domainCount.get(d) || 0) + 1) }

  for (const p of places) {
    if (known.has(p.placeId)) { out.duplicates++; continue }
    if (!nicheMatch(p, niche)) { out.filtered++; continue }
    if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') { out.filtered++; continue }
    if (s.minReviews && p.rating !== undefined && (p.reviewCount || 0) < s.minReviews) { out.filtered++; continue }
    if (s.minRating && p.rating !== undefined && p.rating < s.minRating) { out.filtered++; continue }
    const domain = ownDomain(p.website)
    const isChain = CHAIN_NAMES.test(p.name) || (!!domain && (domainCount.get(domain) || 0) >= 3)
    if (isChain && s.excludeChains) { out.filtered++; continue }

    const facts = hoursFacts(p.hours)
    const data: Prisma.BusinessCreateInput = {
      placeId: p.placeId, source: p.source, search: { connect: { id: search.id } },
      name: p.name.slice(0, 200), niche: niche?.id || null, category: p.category || niche?.label || null, types: p.types.slice(0, 12),
      address: p.address, city: p.city, state: p.state, postalCode: p.postalCode, country: p.country || search.country,
      lat: p.lat, lng: p.lng, phone: p.phone, website: p.website, domain: domain || (p.website ? hostOf(p.website) : null), mapsUrl: p.mapsUrl,
      rating: p.rating, reviewCount: p.reviewCount || 0, businessStatus: p.businessStatus,
      hours: formatHours(p.hours), openDays: facts.openDays, closesAt: facts.closesAt,
      facebook: p.facebook, instagram: p.instagram, isChain,
      notes: p.email ? `listing-email:${p.email}` : null,
    }
    const created = await prisma.business.create({ data }).catch(() => null) // lost a race with a parallel search
    if (!created) { out.duplicates++; continue }
    await rescore(created.id, s)
    out.added++
  }
  return out
}

// ─── 2. Research ─────────────────────────────────────────────────────────────

const RESEARCH_BATCH = 8

export async function researchBatch(deadline: number, onlyIds?: string[]) {
  const s = await getFinderSettings()
  const out = { researched: 0, ready: 0, emails: 0, errors: [] as string[] }
  const batch = await prisma.business.findMany({
    where: onlyIds
      ? { id: { in: onlyIds }, status: { notIn: ['DO_NOT_CONTACT', 'IN_CAMPAIGN'] } }
      : { enrichedAt: null, status: { in: ['NEW'] }, enrichAttempts: { lt: 2 } },
    orderBy: [{ fitScore: 'desc' }, { createdAt: 'asc' }],
    take: onlyIds ? Math.min(onlyIds.length, 25) : RESEARCH_BATCH,
  })
  if (!batch.length) return out
  await prisma.business.updateMany({ where: { id: { in: batch.map((b) => b.id) } }, data: { status: 'RESEARCHING', enrichAttempts: { increment: 1 } } })

  const queue = [...batch]
  const worker = async () => {
    for (let b = queue.shift(); b; b = queue.shift()) {
      if (left(deadline) < 15_000) { queue.unshift(b); return }
      try {
        const ready = await researchOne(b, s, Math.min(deadline - 2_000, Date.now() + 30_000))
        out.researched++
        if (ready) out.ready++
      } catch (err) {
        out.errors.push(`${b.name}: ${(err as Error).message}`)
        await prisma.business.update({ where: { id: b.id }, data: { status: 'NEW' } })
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  // Anything not reached goes back in line
  if (queue.length) await prisma.business.updateMany({ where: { id: { in: queue.map((b) => b.id) } }, data: { status: 'NEW', enrichAttempts: { decrement: 1 } } })

  if (out.ready) {
    await notify({
      type: 'LEADS_READY', title: '{n} new businesses ready to email', count: out.ready,
      body: 'Verified or published contact emails found. Review and add them to a campaign.',
      href: '/finder?status=READY', group: 'finder-ready',
    })
  }
  return out
}

async function researchOne(b: Business, s: FinderSettings, deadline: number) {
  const niche = nicheOf(b.niche)
  const listingEmail = b.notes?.match(/^listing-email:(\S+)/)?.[1] || null
  const r = await researchBusiness({ name: b.name, website: b.website, city: b.city, country: b.country, ownerName: b.ownerName, listingEmail }, niche, s, deadline)

  const existing = new Set((await prisma.businessEmail.findMany({ where: { businessId: b.id }, select: { email: true } })).map((e) => e.email))
  const fresh = r.emails.filter((e) => !existing.has(e.email))
  if (fresh.length) {
    const ownerFirst = (r.ownerName || '').replace(/^Dr\.?\s+/i, '').split(/\s+/)[0]?.toLowerCase()
    await prisma.businessEmail.createMany({
      data: fresh.map((e) => {
        const t = emailTraits(e.email)
        const local = e.email.split('@')[0]
        return {
          businessId: b.id, email: e.email, source: e.source, sourceUrl: e.sourceUrl || null,
          personName: e.personName || (ownerFirst && local.includes(ownerFirst) ? r.ownerName : null) || null,
          position: e.position || null, confidence: e.confidence ?? null,
          status: e.status || 'UNKNOWN', verifyMethod: e.verifyMethod || null, verifyDetail: e.verifyDetail?.slice(0, 250) || null,
          isRole: t.isRole || /^(frontdesk|front|reception|appointments?|service|office|care|smiles?|dental)/.test(local), isFree: t.isFree,
          checkedAt: e.verifyMethod ? new Date() : null,
        }
      }),
      skipDuplicates: true,
    })
  }
  await prisma.business.update({
    where: { id: b.id },
    data: {
      phone: b.phone || r.phone || null,
      contactFormUrl: r.contactFormUrl || b.contactFormUrl,
      facebook: b.facebook || r.facebook || null,
      instagram: b.instagram || r.instagram || null,
      linkedIn: b.linkedIn || r.linkedIn || null,
      ownerName: b.ownerName || r.ownerName || null,
      ownerTitle: b.ownerTitle || r.ownerTitle || null,
      ownerSource: b.ownerSource || r.ownerSource || null,
      techSignals: r.techSignals,
      siteFacts: r.siteFacts,
      searchLog: r.log.join('\n'),
      enrichedAt: new Date(),
    },
  })
  const status = await rescore(b.id, s)
  return status === 'READY'
}

// ─── 3. Score & status ───────────────────────────────────────────────────────

const PUBLISHED = ['LISTING', 'WEBSITE', 'SEARCH', 'MANUAL']

/** May we email this address under the Lead Finder's policy? */
export function isSendable(e: Pick<BusinessEmail, 'status' | 'source' | 'verifyMethod' | 'confidence'>, s: FinderSettings) {
  if (e.status === 'INVALID') return false
  if (e.status === 'VERIFIED') return true
  if (s.sendPolicy !== 'VERIFIED_OR_PUBLISHED' || !e.verifyMethod) return false
  // Published by the business itself (its site, its listing): fine even on catch-all domains
  if (PUBLISHED.includes(e.source)) return true
  return e.source === 'HUNTER' && e.status === 'UNKNOWN' && (e.confidence || 0) >= 90
}

/** Best address: the owner's own > a verified personal one > a verified role inbox > published */
export function bestBizEmail<T extends Pick<BusinessEmail, 'status' | 'source' | 'verifyMethod' | 'confidence' | 'isRole' | 'isFree' | 'isPrimary' | 'personName'>>(emails: T[], s: FinderSettings) {
  const rank = (e: T) => (e.isPrimary ? 1000 : 0) + (e.personName ? 60 : 0) + (e.status === 'VERIFIED' ? 40 : 0) + (e.isRole ? 0 : 25) +
    (e.isFree ? 0 : 10) + (PUBLISHED.includes(e.source) ? 8 : 0) + Math.round((e.confidence || 0) / 20)
  return emails.filter((e) => isSendable(e, s)).sort((a, b) => rank(b) - rank(a))[0] || null
}

export function scoreBusiness(b: Business, emails: BusinessEmail[], s: FinderSettings) {
  const niche = nicheOf(b.niche)
  const reasons: string[] = []
  const add = (n: number, why: string) => { score += n; reasons.push(`${n > 0 ? '+' : ''}${n} ${why}`) }
  let score = 0
  if (niche) add(niche.callValue * 6, niche.callValue === 3 ? 'every missed call is expensive in this niche' : 'phone-driven niche')
  if (ownDomain(b.website)) add(10, 'own website')
  else if (b.website) add(3, 'only a social page')
  if (b.phone) add(5, 'takes calls')
  const rc = b.reviewCount
  if (rc >= 10 && rc <= 400) add(15, `${rc} reviews: busy independent`)
  else if (rc > 400 && rc <= 1500) add(8, `${rc} reviews: high volume`)
  else if (rc > 1500) add(2, `${rc} reviews: probably a large group`)
  else if (rc > 0) add(4, `${rc} reviews: new or quiet`)
  if (b.rating) {
    if (b.rating >= 4.6) add(8, `${b.rating.toFixed(1)}★, proud of their service`)
    else if (b.rating >= 4.0) add(4, `${b.rating.toFixed(1)}★`)
    else if (rc >= 10) add(4, `${b.rating.toFixed(1)}★: service complaints are a pain point`)
  }
  if (b.hours) {
    if (/sat-sun closed|sun closed|sat closed/i.test(b.hours)) add(8, 'closed at weekends: calls go to voicemail')
    const close = Number(b.closesAt?.match(/^(\d+)/)?.[1] || 0)
    if (b.closesAt && /pm$/.test(b.closesAt) && close <= 5) add(6, `closes at ${b.closesAt}`)
    if (b.openDays && b.openDays <= 4) add(4, `open ${b.openDays} days a week`)
  }
  const facts = b.siteFacts.join(' ')
  if (/new patients/i.test(facts)) add(4, 'taking new patients')
  if (/Emergency|24\/7/i.test(facts)) add(3, 'urgent calls')
  if (/Text us/i.test(facts)) add(4, 'phones are hard to keep up with')
  if (/special/i.test(facts)) add(3, 'paying to make the phone ring')
  if (/Spanish/i.test(facts)) add(2, 'bilingual callers')
  if (b.ownerName) add(5, `decision maker known (${b.ownerName})`)
  if (b.techSignals.some((t) => /competitor/i.test(t))) add(-15, 'already has an answering service / AI receptionist')
  else if (b.techSignals.length) add(2, 'already pays for customer tech')

  const best = bestBizEmail(emails, s)
  const live = emails.filter((e) => e.status !== 'INVALID')
  if (best) add(best.isRole ? 10 : 15, best.isRole ? 'reachable (front-desk inbox)' : 'reachable (personal inbox)')
  else if (live.length) add(4, 'email found, not confirmed yet')
  else if (b.enrichedAt) add(-10, 'no email anywhere: call instead')
  if (b.isChain) add(-40, 'chain / franchise')

  score = Math.max(0, Math.min(100, score))
  const tier = best && score >= 80 ? 'HOT' : score >= 55 ? 'WARM' : 'COLD'
  return { score, reasons, tier, best }
}

/** Recompute score, tier and status; returns the status */
export async function rescore(id: string, settings?: FinderSettings) {
  const s = settings || await getFinderSettings()
  const b = await prisma.business.findUnique({ where: { id }, include: { emails: true, lead: { select: { id: true } } } })
  if (!b) return null
  const { score, reasons, tier, best } = scoreBusiness(b, b.emails, s)
  let status = b.status
  if (b.lead) status = 'IN_CAMPAIGN'
  else if (['DO_NOT_CONTACT', 'EXCLUDED'].includes(b.status)) status = b.status
  else if (b.isChain && s.excludeChains) status = 'EXCLUDED'
  else if (!b.enrichedAt) status = b.status === 'RESEARCHING' ? 'RESEARCHING' : 'NEW'
  else if (best) status = 'READY'
  else if (b.emails.some((e) => e.status !== 'INVALID')) status = 'EMAIL_FOUND'
  else status = 'NO_EMAIL'
  await prisma.business.update({ where: { id }, data: { fitScore: score, fitReasons: reasons, tier, status, excludeReason: status === 'EXCLUDED' && b.isChain ? 'Chain / franchise' : b.excludeReason } })
  return status
}

// ─── 4. Push to a campaign ───────────────────────────────────────────────────

export interface BizPushResult { added: number; skipped: Array<{ id: string; name: string; reason: string }>; byCampaign: Record<string, number> }

/** The campaign whose industry matches the niche ("Dentists" → the campaign with industry "Dentists") */
export async function campaignForNiche(nicheId: string | null) {
  const niche = nicheOf(nicheId)
  if (!niche) return null
  const c = await prisma.campaign.findFirst({
    where: { OR: [{ industry: { equals: niche.label, mode: 'insensitive' } }, { industry: { equals: niche.id, mode: 'insensitive' } }, { industry: { equals: niche.query, mode: 'insensitive' } }] },
    orderBy: { createdAt: 'desc' }, select: { id: true, name: true },
  })
  return c
}

/** A campaign for a niche with its ready-made 4-step sequence, created as a DRAFT to review */
export async function createNicheCampaign(nicheId: string, location?: string) {
  const niche = nicheOf(nicheId)
  if (!niche) throw new Error('Unknown niche')
  const existing = await campaignForNiche(nicheId)
  if (existing) return existing
  const seq = SEQUENCE_LIBRARY.find((q) => q.id === niche.sequence) || SEQUENCE_LIBRARY.find((q) => q.id === 'general')!
  return prisma.campaign.create({
    data: {
      name: `${niche.label}${location ? ` — ${location}` : ''}`,
      industry: niche.label,
      product: 'Triven AI Receptionist',
      description: `Lead Finder: ${niche.label.toLowerCase()} from Google Maps / OpenStreetMap. Sequence: ${seq.niche}.`,
      followUpDay1: 3, followUpDay2: 7, followUpDay3: 14, dailyNewLeads: 30, sendingStatus: 'DRAFT',
      templates: { create: seq.steps.map((st) => ({ name: st.name, subject: st.subject, body: st.body, type: st.type, isDefault: true })) },
    },
    select: { id: true, name: true },
  })
}

export async function pushBusinesses(ids: string[], target: { campaignId?: string; byNiche?: boolean }, userId?: string): Promise<BizPushResult> {
  const s = await getFinderSettings()
  const out: BizPushResult = { added: 0, skipped: [], byCampaign: {} }
  const businesses = await prisma.business.findMany({ where: { id: { in: ids } }, include: { emails: true, lead: { select: { id: true } } } })
  const campaignNames = new Map((await prisma.campaign.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]))
  const nicheCampaign = new Map<string, string | null>()

  for (const b of businesses) {
    const skip = (reason: string) => out.skipped.push({ id: b.id, name: b.name, reason })
    if (b.lead) { skip('already in a campaign'); continue }
    if (['DO_NOT_CONTACT', 'EXCLUDED'].includes(b.status)) { skip(b.status === 'EXCLUDED' ? 'excluded' : 'do not contact'); continue }
    const email = bestBizEmail(b.emails, s)
    if (!email) { skip('no email that passes the rules'); continue }
    const domain = email.email.split('@')[1]
    const suppressed = await prisma.suppressionEntry.findFirst({ where: { OR: [{ email: email.email }, { domain }] } })
    if (suppressed) {
      await prisma.business.update({ where: { id: b.id }, data: { status: 'DO_NOT_CONTACT' } })
      skip('on the suppression list'); continue
    }
    const dupe = await prisma.lead.findFirst({ where: { companyEmail: email.email }, select: { id: true } })
    if (dupe) { skip('this email is already a lead'); continue }

    let campaignId = target.campaignId
    if (!campaignId && target.byNiche) {
      const key = b.niche || ''
      if (!nicheCampaign.has(key)) nicheCampaign.set(key, (await campaignForNiche(b.niche))?.id || null)
      campaignId = nicheCampaign.get(key) || undefined
    }
    if (!campaignId) { skip(`no campaign for ${nicheOf(b.niche)?.label || 'this niche'}`); continue }

    const niche = nicheOf(b.niche)
    const personal = !email.isRole && !!email.personName
    const rawOwner = (b.ownerName || '').trim()
    // Doctors are addressed as "Dr. Surname" by the templates
    const owner = rawOwner && !/^Dr\.?\s/i.test(rawOwner) && /^(DDS|DMD|MD|DVM|DC|OD|Doctor|Dentist|Orthodontist|Periodontist|Chiropractor|Veterinarian)\b/i.test(b.ownerTitle || '') ? `Dr. ${rawOwner}` : rawOwner
    const plainOwner = owner.replace(/^Dr\.?\s+/i, '')
    const [first, ...rest] = plainOwner.split(/\s+/)
    const where = [b.city, b.state].filter(Boolean).join(', ')
    const why = [
      `Found on ${b.source === 'OSM' ? 'OpenStreetMap' : 'Google Maps'}: ${b.category || niche?.label || 'business'}${where ? ` in ${where}` : ''}.`,
      b.rating ? `${b.rating.toFixed(1)} stars from ${b.reviewCount} Google reviews.` : '',
      b.hours ? `Hours: ${b.hours}.` : '',
    ].filter(Boolean).join(' ')
    const lead = await prisma.lead.create({
      data: {
        firstName: personal && first ? first : null,
        lastName: personal && rest.length ? rest[rest.length - 1] : null,
        fullName: owner || null,
        jobTitle: b.ownerTitle,
        companyName: b.name,
        website: b.website,
        companyEmail: email.email,
        phone: b.phone,
        linkedIn: b.linkedIn,
        country: b.country,
        state: b.state,
        city: b.city,
        industry: niche?.label || b.category,
        subIndustry: b.category,
        campaignId,
        leadSource: b.source === 'OSM' ? 'OSM' : 'GOOGLE_MAPS',
        status: 'READY_TO_CONTACT',
        priority: b.tier === 'HOT' ? 'HIGH' : b.tier === 'WARM' ? 'MEDIUM' : 'LOW',
        score: b.fitScore,
        assignedUserId: userId,
        whyThisLead: why,
        personalizationNotes: [...b.siteFacts, owner && /^Dr/i.test(owner) ? owner : ''].filter(Boolean).join('. ') || null,
        companyPainPoint: b.fitReasons.filter((r) => r.startsWith('+') && /voicemail|closes|days a week|keep up|urgent|complaints/.test(r)).map((r) => r.replace(/^\+\d+\s*/, '')).join('; ') || null,
        researchSummary: `Fit ${b.fitScore}/100 (${b.tier.toLowerCase()}):\n${b.fitReasons.join('\n')}`,
        websiteNotes: [b.techSignals.length ? `Tools on their site: ${b.techSignals.join(', ')}` : '', b.contactFormUrl ? `Contact form: ${b.contactFormUrl}` : ''].filter(Boolean).join('\n') || null,
        socialMediaNotes: [b.mapsUrl, b.facebook, b.instagram, b.linkedIn].filter(Boolean).join('\n') || null,
        prospectingNotes: `Email from ${email.source.toLowerCase().replace('_', ' ')}, ${email.status.toLowerCase()}${email.verifyMethod ? ` (${email.verifyMethod.toLowerCase()})` : ''}${email.confidence ? `, confidence ${email.confidence}` : ''}${email.sourceUrl ? ` · ${email.sourceUrl}` : ''}`,
        businessId: b.id,
        sourcePlatform: b.source,
      },
    })
    await prisma.activity.create({
      data: {
        leadId: lead.id, userId, type: 'NOTE_ADDED', title: `Added from Lead Finder (${b.source === 'OSM' ? 'OpenStreetMap' : 'Google Maps'})`,
        body: `${why}\n\nWhere the email came from:\n${b.searchLog || ''}`.slice(0, 4000),
        metadata: { businessId: b.id, mapsUrl: b.mapsUrl },
      },
    })
    await prisma.business.update({ where: { id: b.id }, data: { status: 'IN_CAMPAIGN' } })
    out.added++
    const cname = campaignNames.get(campaignId) || campaignId
    out.byCampaign[cname] = (out.byCampaign[cname] || 0) + 1
  }
  return out
}

// ─── Orchestration ───────────────────────────────────────────────────────────

export async function finderBacklog() {
  const [searches, research] = await Promise.all([
    prisma.leadSearch.count({ where: { status: { in: ['QUEUED', 'RUNNING'] } } }),
    prisma.business.count({ where: { enrichedAt: null, status: 'NEW', enrichAttempts: { lt: 2 } } }),
  ])
  return { searches, research, total: searches + research }
}

/** Worker entry: continue running searches, then research new businesses */
export async function runFinder(deadline: number) {
  const result: Record<string, unknown> = {}
  const searches = await prisma.leadSearch.findMany({ where: { status: { in: ['QUEUED', 'RUNNING'] } }, orderBy: { createdAt: 'asc' }, take: 3, select: { id: true } })
  const searchDeadline = Math.min(deadline, Date.now() + (deadline - Date.now()) * 0.4)
  for (const { id } of searches) {
    if (left(searchDeadline) < 12_000) break
    const s = await runSearch(id, searchDeadline)
    result[`search:${id}`] = s?.status
  }
  result.research = await researchBatch(deadline)
  return result
}
