// Learning loop (PRD R10.5, R6.6): what actually converts, by use case, persona, stage,
// source and evidence type, plus A/B results per campaign. Suggestions are shown for a
// person to act on; nothing changes weights automatically. Small samples are labelled as such.
import prisma from './prisma'
import { notify } from './notify'
import { useCaseLabel } from './audience/usecases'
import { PERSONAS } from './audience/taxonomy'

const MIN_SAMPLE = 20

interface Group { key: string; label: string; contacted: number; replied: number; positive: number; meetings: number }

function rates(g: Group) {
  return { ...g, replyRate: g.contacted ? g.replied / g.contacted : 0, positiveRate: g.contacted ? g.positive / g.contacted : 0 }
}

export async function insights() {
  const leads = await prisma.lead.findMany({
    where: { firstEmailSentAt: { not: null } },
    select: {
      hasReplied: true, isInterested: true, meetingBooked: true, useCase: true, persona: true, industry: true, leadSource: true, sourcePlatform: true, sourceChannel: true,
      campaignId: true, templateVariant: true, replyCategory: true,
      prospect: { select: { buildStage: true, forWhom: true, evidence: { select: { type: true } } } },
    },
    take: 20_000,
  })
  const total = { contacted: leads.length, replied: leads.filter((l) => l.hasReplied).length, positive: leads.filter((l) => l.isInterested).length, meetings: leads.filter((l) => l.meetingBooked).length }
  const baseReply = total.contacted ? total.replied / total.contacted : 0
  const basePositive = total.contacted ? total.positive / total.contacted : 0

  const group = (dimension: string, keyOf: (l: (typeof leads)[number]) => string | string[] | null | undefined, label: (k: string) => string) => {
    const map = new Map<string, Group>()
    for (const l of leads) {
      const keys = keyOf(l)
      for (const k of (Array.isArray(keys) ? keys : [keys]).filter(Boolean) as string[]) {
        const g = map.get(k) || { key: k, label: label(k), contacted: 0, replied: 0, positive: 0, meetings: 0 }
        g.contacted++; if (l.hasReplied) g.replied++; if (l.isInterested) g.positive++; if (l.meetingBooked) g.meetings++
        map.set(k, g)
      }
    }
    return { dimension, rows: [...map.values()].map(rates).sort((a, b) => b.contacted - a.contacted) }
  }

  const SOURCE: Record<string, string> = { YOUTUBE: 'YouTube', HN: 'Hacker News', DEVTO: 'DEV', COMMUNITY: 'Community', GOOGLE: 'Google Maps', OSM: 'OpenStreetMap' }
  const dims = [
    group('Use case', (l) => l.useCase, (k) => useCaseLabel(k)),
    group('Persona', (l) => l.persona, (k) => PERSONAS[k as keyof typeof PERSONAS]?.label || k),
    group('Stage', (l) => l.prospect?.buildStage, (k) => k.toLowerCase()),
    group('Builds for', (l) => l.prospect?.forWhom, (k) => k.toLowerCase()),
    group('Source', (l) => l.sourcePlatform || l.leadSource, (k) => SOURCE[k] || k.toLowerCase()),
    group('Evidence type', (l) => [...new Set(l.prospect?.evidence.map((e) => e.type) || [])], (k) => k.toLowerCase().replace(/_/g, ' ')),
    group('Industry', (l) => (l.useCase ? null : l.industry), (k) => k),
  ]

  // Suggestions: only from groups big enough to mean something
  const suggestions: string[] = []
  for (const d of dims) {
    for (const r of d.rows.filter((x) => x.contacted >= MIN_SAMPLE)) {
      if (basePositive > 0 && r.positiveRate >= basePositive * 1.5) suggestions.push(`${d.dimension} "${r.label}" converts ${(r.positiveRate / basePositive).toFixed(1)}× better than average (${r.positive}/${r.contacted}). ${d.dimension === 'Evidence type' ? 'Consider raising its weight.' : 'Point more sourcing and segments at it.'}`)
      else if (basePositive > 0 && r.positiveRate <= basePositive * 0.5 && r.contacted >= MIN_SAMPLE * 2) suggestions.push(`${d.dimension} "${r.label}" converts at under half the average (${r.positive}/${r.contacted}). ${d.dimension === 'Evidence type' ? 'Consider lowering its weight.' : 'Consider sending less of it.'}`)
    }
  }

  // A/B per campaign
  const byCampaign = new Map<string, { A: Group; B: Group }>()
  for (const l of leads.filter((x) => x.templateVariant && x.campaignId)) {
    const e = byCampaign.get(l.campaignId!) || { A: { key: 'A', label: 'A', contacted: 0, replied: 0, positive: 0, meetings: 0 }, B: { key: 'B', label: 'B', contacted: 0, replied: 0, positive: 0, meetings: 0 } }
    const g = e[l.templateVariant as 'A' | 'B']
    if (g) { g.contacted++; if (l.hasReplied) g.replied++; if (l.isInterested) g.positive++; if (l.meetingBooked) g.meetings++ }
    byCampaign.set(l.campaignId!, e)
  }
  const names = new Map((await prisma.campaign.findMany({ where: { id: { in: [...byCampaign.keys()] } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]))
  const abTests = [...byCampaign].map(([id, v]) => {
    const a = rates(v.A), b = rates(v.B)
    const decided = a.contacted >= 200 && b.contacted >= 200
    const winner = decided ? (b.replyRate > a.replyRate ? 'B' : 'A') : null
    return { campaignId: id, campaign: names.get(id) || id, A: a, B: b, winner, note: decided ? `Variant ${winner} wins on reply rate` : `Needs 200 sends per variant (${a.contacted} / ${b.contacted} so far)` }
  })

  return { total: { ...total, replyRate: baseReply, positiveRate: basePositive }, dimensions: dims, suggestions, abTests, minSample: MIN_SAMPLE }
}

/** Weekly (from the daily job): tell someone when there's something to learn */
export async function weeklyInsightsNotice() {
  const row = await prisma.setting.findUnique({ where: { key: 'insights_last_notice' } })
  if (row && Date.now() - Number(row.value) < 7 * 86_400_000) return { skipped: true }
  const value = String(Date.now())
  await prisma.setting.upsert({ where: { key: 'insights_last_notice' }, create: { key: 'insights_last_notice', value }, update: { value } })
  const i = await insights()
  if (!i.suggestions.length) return { suggestions: 0 }
  await notify({ type: 'SYSTEM', title: `${i.suggestions.length} things the data says this week`, body: i.suggestions[0], href: '/analytics#insights', group: 'insights', cooldownHours: 24 * 6 })
  return { suggestions: i.suggestions.length }
}
