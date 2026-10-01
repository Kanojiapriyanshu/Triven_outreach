// Proactive alerts, checked by the worker at most once an hour: things that quietly cost
// replies if nobody notices (a campaign running dry, bounces climbing, credits running out).
import prisma from './prisma'
import { notify } from './notify'
import { hunterAccount, hunterConfigured } from './audience/hunter'
import { getAudienceSettings } from './audience/settings'
import { googleUsage } from './finder/places'
import { getFinderSettings } from './finder/settings'
import { campaignCapacity } from './capacity'

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

  // 2b. A campaign bouncing over 3% (30+ sends in 7 days) pauses itself
  for (const c of await prisma.campaign.findMany({ where: { sendingStatus: 'ACTIVE' }, select: { id: true, name: true } })) {
    // Counted from the last resume after a bounce pause (if any), so a cleaned-up campaign gets a fresh start
    const resumed = await prisma.setting.findUnique({ where: { key: `bounce_guard:${c.id}` } })
    const since = resumed && new Date(resumed.value) > weekAgo ? new Date(resumed.value) : weekAgo
    const [cs, cb] = await Promise.all([
      prisma.lead.count({ where: { campaignId: c.id, firstEmailSentAt: { gte: since } } }),
      prisma.lead.count({ where: { campaignId: c.id, firstEmailSentAt: { gte: since }, status: 'INVALID_EMAIL' } }),
    ])
    // 30+ sends over 3%, or (so a bad batch is caught early) 4 bounces in the first 20
    if ((cs >= 30 && cb / cs > 0.03) || (cs < 30 && cb >= 4)) {
      const reason = `${(100 * cb / cs).toFixed(1)}% bounce rate ${since > weekAgo ? 'since it was resumed' : 'in 7 days'}`
      await prisma.campaign.update({ where: { id: c.id }, data: { sendingStatus: 'PAUSED', pausedReason: reason } })
      await notify({ type: 'BOUNCE', title: `${c.name} paused: ${reason}`, body: 'Tighten the email rules (verified only) or clean the list, then resume.', href: '/campaigns', group: `camp-bounce:${c.id}`, cooldownHours: 24 })
      raised.push(`paused:${c.name}`)
    }
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

  // 5. Ready people nobody added to a campaign for a day
  const stale = await prisma.prospect.count({ where: { status: 'READY_TO_CONTACT', updatedAt: { lt: new Date(Date.now() - 86_400_000) } } })
  const staleBiz = await prisma.business.count({ where: { status: 'READY', updatedAt: { lt: new Date(Date.now() - 86_400_000) } } })
  if (stale + staleBiz > 0) {
    await notify({
      type: 'LEADS_READY', title: `${stale + staleBiz} ready people waiting over a day`,
      body: 'They have a confirmed email but aren\'t in a campaign. Add them, or turn on auto-add for the campaign.',
      href: stale ? '/audience/prospects?status=READY_TO_CONTACT' : '/finder?status=READY', group: 'ready-stale', cooldownHours: 24,
    })
    raised.push('ready-stale')
  }

  // 6. Collection has nothing to work on
  const [collecting, discovered] = await Promise.all([
    prisma.audienceVideo.count({ where: { status: { in: ['QUEUED', 'COLLECTING'] } } }),
    prisma.audienceVideo.count({ where: { status: 'DISCOVERED' } }),
  ])
  if (!collecting && !discovered) {
    await notify({ type: 'SYSTEM', title: 'No new sources to collect', body: 'Every found video and thread has been read. Search for more in Discover, or track more channels.', href: '/audience/discover', group: 'sources-empty', cooldownHours: 24 })
    raised.push('sources-empty')
  }

  // 7. Capacity left unused while people were queued (checked once the day's window has passed)
  for (const c of (await campaignCapacity()).filter((x) => x.status === 'ACTIVE')) {
    if (c.queued > 0 && c.sentToday === 0 && !c.windowOpen && c.state !== 'SENDING') {
      await notify({ type: 'CAMPAIGN_EMPTY', title: `${c.name} sent nothing today`, body: `${c.queued} people are queued. Reason: ${c.reason}`, href: '/system', group: `idle:${c.id}`, cooldownHours: 20 })
      raised.push(`idle:${c.name}`)
    }
  }

  return { raised }
}
