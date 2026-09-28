// Proactive alerts, checked by the worker at most once an hour: things that quietly cost
// replies if nobody notices (a campaign running dry, bounces climbing, credits running out).
import prisma from './prisma'
import { notify } from './notify'
import { hunterAccount, hunterConfigured } from './audience/hunter'
import { getAudienceSettings } from './audience/settings'
import { googleUsage } from './finder/places'
import { getFinderSettings } from './finder/settings'

const KEY = 'health_last_check'

export async function checkHealth(force = false) {
  const last = await prisma.setting.findUnique({ where: { key: KEY } })
  if (!force && last && Date.now() - Number(last.value) < 3_600_000) return { skipped: true }
  const value = String(Date.now())
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } })
  const raised: string[] = []

  // 1. Active campaigns about to run out of people to email
  const campaigns = await prisma.campaign.findMany({ where: { sendingStatus: 'ACTIVE' }, select: { id: true, name: true, industry: true, dailyNewLeads: true } })
  for (const c of campaigns) {
    const queued = await prisma.lead.count({ where: { campaignId: c.id, firstEmailSentAt: null, companyEmail: { not: null }, hasReplied: false, status: { in: ['NEW', 'READY_TO_CONTACT', 'RESEARCHING'] } } })
    if (queued === 0) {
      await notify({ type: 'CAMPAIGN_EMPTY', title: `${c.name} has no one left to email`, body: 'Follow-ups continue, but no new first emails go out. Add businesses from the Lead Finder or prospects from Audience.', href: '/finder?status=READY', group: `empty:${c.id}`, cooldownHours: 24 })
      raised.push(`empty:${c.name}`)
    } else if (queued < c.dailyNewLeads) {
      await notify({ type: 'CAMPAIGN_EMPTY', title: `${c.name}: less than a day of leads left (${queued})`, body: 'Top it up so sending doesn\'t stall tomorrow.', href: '/finder?status=READY', group: `low:${c.id}`, cooldownHours: 24 })
      raised.push(`low:${c.name}`)
    }
  }

  // 2. Bounce rate over the last 7 days (above ~3% hurts the sending domain)
  const weekAgo = new Date(Date.now() - 7 * 86_400_000)
  const [sent, bounced] = await Promise.all([
    prisma.lead.count({ where: { firstEmailSentAt: { gte: weekAgo } } }),
    prisma.lead.count({ where: { firstEmailSentAt: { gte: weekAgo }, status: 'INVALID_EMAIL' } }),
  ])
  if (sent >= 30 && bounced / sent > 0.03) {
    await notify({
      type: 'BOUNCE', title: `Bounce rate ${(100 * bounced / sent).toFixed(1)}% this week`,
      body: `${bounced} of ${sent} first emails bounced. Switch Lead Finder / Audience rules to "verified only", or add an email verifier key.`,
      href: '/finder?settings=1', group: 'bounce', cooldownHours: 48,
    })
    raised.push('bounce')
  }

  // 3. Credits and quotas
  if (hunterConfigured()) {
    const acct = await hunterAccount().catch(() => null)
    const reserve = (await getAudienceSettings()).hunterReserve
    if (acct && acct.remaining <= reserve + 2) {
      await notify({ type: 'CREDITS_LOW', title: `Hunter: ${acct.remaining} credits left`, body: `Email finding falls back to websites and web search until ${acct.resetDate || 'the monthly reset'}.`, href: '/finder', group: 'hunter', cooldownHours: 72 })
      raised.push('hunter')
    }
  }
  const [used, cap] = [await googleUsage(), (await getFinderSettings()).googleMonthlyCap]
  if (cap > 0 && used >= cap * 0.8 && used < cap) {
    await notify({ type: 'QUOTA', title: `Google Maps: ${used} of ${cap} monthly calls used`, body: 'Searches stop at the cap so nothing is billed. OpenStreetMap keeps working.', href: '/finder?settings=1', group: 'google-80', cooldownHours: 72 })
    raised.push('google')
  }

  // 4. New outreach-ready audience prospects since the last check
  const readyNow = await prisma.prospect.count({ where: { status: 'READY_TO_CONTACT' } })
  const seenRow = await prisma.setting.findUnique({ where: { key: 'health_prospects_ready' } })
  const seen = Number(seenRow?.value || 0)
  // The first check only records the baseline, so nobody gets a "1,000 new" alert on day one
  if (seenRow && readyNow > seen) {
    await notify({ type: 'LEADS_READY', title: '{n} new audience prospects ready', count: readyNow - seen, body: 'Builders with a verified business email. Add them to the AI Builder campaigns.', href: '/audience/prospects?status=READY_TO_CONTACT', group: 'audience-ready' })
    raised.push('audience-ready')
  }
  await prisma.setting.upsert({ where: { key: 'health_prospects_ready' }, create: { key: 'health_prospects_ready', value: String(readyNow) }, update: { value: String(readyNow) } })

  return { raised }
}
