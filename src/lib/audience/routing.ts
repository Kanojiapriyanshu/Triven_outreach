// Which campaign a ready person goes to (PRD R6.2) and automatic adding (R6.5).
// Use case chooses the campaign; when that use-case campaign doesn't exist yet, the older
// persona campaigns ("AI Builder — Founders" …) are the fallback.
import prisma from '../prisma'
import { USE_CASE_CAMPAIGNS, USE_CASE_SEQUENCES, useCaseCampaignKey } from './usecase-sequences'

export { USE_CASE_CAMPAIGNS }

/** Create the use-case campaigns that don't exist yet (as drafts, each with its 4-step sequence) */
export async function ensureUseCaseCampaigns() {
  let created = 0
  for (const c of USE_CASE_CAMPAIGNS) {
    const exists = await prisma.campaign.findFirst({ where: { OR: [{ useCase: c.key }, { name: c.name }] } })
    if (exists) continue
    const seq = USE_CASE_SEQUENCES.find((s) => s.id === c.key)!
    await prisma.campaign.create({
      data: {
        name: c.name, industry: 'AI Builder', product: 'Triven AI Builder', useCase: c.key,
        description: seq.description, followUpDay1: 3, followUpDay2: 7, followUpDay3: 14, dailyNewLeads: 30, sendingStatus: 'DRAFT',
        recipientHours: true,
        templates: { create: seq.steps.map((s) => ({ name: s.name, subject: s.subject, body: s.body, type: s.type, isDefault: true })) },
      },
    })
    created++
  }
  return created
}

export async function useCaseRoutes() {
  const rows = await prisma.campaign.findMany({ where: { useCase: { not: null } }, select: { id: true, useCase: true } })
  return new Map(rows.map((r) => [r.useCase!, r.id]))
}

/** Campaign id for one person: their use-case campaign, else their persona campaign */
export function routeFor(p: { useCase?: string | null; forWhom?: string | null; persona?: string | null }, ucRoutes: Map<string, string>, persona: { route: Record<string, string>; fallback: string | null } | null) {
  return ucRoutes.get(useCaseCampaignKey(p)) || (p.persona && persona?.route[p.persona]) || persona?.fallback || null
}

/** READY people and businesses go into their campaign on their own, for campaigns that opted in */
export async function autoPushReady(minOpportunity = 0) {
  const out = { prospects: 0, businesses: 0 }
  const campaigns = await prisma.campaign.findMany({ where: { autoPush: true, sendingStatus: 'ACTIVE' }, select: { id: true, useCase: true, industry: true } })
  if (!campaigns.length) return out
  const open = new Set(campaigns.map((c) => c.id))

  const { pushToCampaign, routeCampaigns } = await import('./actions')
  const [ready, ucRoutes, persona] = await Promise.all([
    prisma.prospect.findMany({
      where: { status: 'READY_TO_CONTACT', inauthentic: false, opportunityScore: { gte: minOpportunity }, lead: null },
      select: { id: true, useCase: true, forWhom: true, persona: true },
      orderBy: { opportunityScore: 'desc' }, take: 200,
    }),
    useCaseRoutes(),
    routeCampaigns(),
  ])
  const byCampaign = new Map<string, string[]>()
  for (const p of ready) {
    const id = routeFor(p, ucRoutes, persona)
    if (!id || !open.has(id)) continue
    byCampaign.set(id, [...(byCampaign.get(id) || []), p.id])
  }
  for (const [campaignId, ids] of byCampaign) out.prospects += (await pushToCampaign(ids, { campaignId })).added

  // Lead Finder businesses → their niche campaign
  const { campaignForNiche, pushBusinesses } = await import('../finder/pipeline')
  const businesses = await prisma.business.findMany({ where: { status: 'READY', lead: null }, select: { id: true, niche: true }, orderBy: { fitScore: 'desc' }, take: 200 })
  const nicheCampaign = new Map<string, string | null>()
  const bizBy = new Map<string, string[]>()
  for (const b of businesses) {
    const key = b.niche || ''
    if (!nicheCampaign.has(key)) nicheCampaign.set(key, (await campaignForNiche(b.niche))?.id || null)
    const id = nicheCampaign.get(key)
    if (!id || !open.has(id)) continue
    bizBy.set(id, [...(bizBy.get(id) || []), b.id])
  }
  for (const [campaignId, ids] of bizBy) out.businesses += (await pushBusinesses(ids, { campaignId })).added
  return out
}
