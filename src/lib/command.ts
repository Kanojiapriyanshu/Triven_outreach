// "What should I do next?" The dashboard's action list, ranked by money impact:
// people who replied first, then anything blocking email from going out, then pipeline refills.
import prisma from './prisma'
import { getSettings } from './settings'
import { googleConfigured } from './finder/places'
import { verifierProvider } from './audience/verify'
import { searchProvider } from './audience/identity'

export interface NextMove {
  id: string
  severity: 'urgent' | 'high' | 'normal' | 'setup'
  title: string
  detail: string
  href: string
  cta: string
  count?: number
}

export async function nextMoves(): Promise<NextMove[]> {
  const now = new Date()
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0)
  const [
    unreadReplies, interested, overdue, businessesReady, prospectsReady, callList,
    draftCampaigns, activeCampaigns, brokenInboxes, senders, settings,
  ] = await Promise.all([
    prisma.emailMessage.groupBy({ by: ['leadId'], where: { direction: 'INBOUND', isRead: false } }).then((r) => r.length),
    prisma.lead.count({ where: { status: 'INTERESTED', meetingBooked: false } }),
    prisma.followUpTask.count({ where: { status: 'PENDING', scheduledAt: { lt: startOfToday } } }),
    prisma.business.count({ where: { status: 'READY' } }),
    prisma.prospect.count({ where: { status: 'READY_TO_CONTACT' } }),
    prisma.business.count({ where: { status: { in: ['NO_EMAIL', 'EMAIL_FOUND'] }, phone: { not: null }, tier: { in: ['HOT', 'WARM'] } } }),
    prisma.campaign.findMany({ where: { sendingStatus: 'DRAFT' }, select: { id: true, name: true, _count: { select: { leads: true } } } }),
    prisma.campaign.findMany({ where: { sendingStatus: 'ACTIVE' }, select: { id: true, name: true, dailyNewLeads: true } }),
    prisma.senderAccount.findMany({ where: { isActive: true, gmailStatus: { in: ['EXPIRED', 'ERROR'] } }, select: { email: true } }),
    prisma.senderAccount.count({ where: { isActive: true, gmailStatus: 'CONNECTED' } }),
    getSettings(),
  ])

  const moves: NextMove[] = []
  if (unreadReplies) moves.push({ id: 'replies', severity: 'urgent', title: `Reply to ${unreadReplies} ${unreadReplies === 1 ? 'person' : 'people'}`, detail: 'Replies answered within an hour convert several times better than next-day ones.', href: '/inbox', cta: 'Open inbox', count: unreadReplies })
  if (interested) moves.push({ id: 'interested', severity: 'urgent', title: `Book ${interested} interested lead${interested === 1 ? '' : 's'}`, detail: 'They said yes but no meeting is booked yet.', href: '/leads?status=INTERESTED', cta: 'See leads', count: interested })
  for (const b of brokenInboxes) moves.push({ id: `inbox:${b.email}`, severity: 'urgent', title: `Reconnect ${b.email}`, detail: 'Sending and reply tracking are paused for this inbox.', href: '/sender-accounts', cta: 'Reconnect' })
  if (overdue) moves.push({ id: 'overdue', severity: 'high', title: `${overdue} follow-up${overdue === 1 ? '' : 's'} overdue`, detail: 'Usually outside the send window or an inbox at its daily cap.', href: '/today', cta: "Today's work", count: overdue })

  for (const c of draftCampaigns.filter((c) => c._count.leads > 0)) {
    moves.push({ id: `launch:${c.id}`, severity: 'high', title: `Launch "${c.name}"`, detail: `${c._count.leads} lead${c._count.leads === 1 ? ' is' : 's are'} waiting in a draft campaign. Check the sequence, then launch.`, href: '/campaigns', cta: 'Review & launch', count: c._count.leads })
  }
  for (const c of activeCampaigns) {
    const queued = await prisma.lead.count({ where: { campaignId: c.id, firstEmailSentAt: null, companyEmail: { not: null }, hasReplied: false, status: { in: ['NEW', 'READY_TO_CONTACT', 'RESEARCHING'] } } })
    if (queued < c.dailyNewLeads) moves.push({ id: `refill:${c.id}`, severity: 'high', title: `Refill "${c.name}"`, detail: queued ? `Only ${queued} left: less than a day of sending.` : 'No one left to email: new first emails have stopped.', href: '/finder?status=READY', cta: 'Find leads', count: queued })
  }

  if (businessesReady) moves.push({ id: 'biz-ready', severity: 'normal', title: `${businessesReady} businesses ready to email`, detail: 'Found, researched and with an email that passes your rules.', href: '/finder?status=READY', cta: 'Add to campaign', count: businessesReady })
  if (prospectsReady) moves.push({ id: 'aud-ready', severity: 'normal', title: `${prospectsReady} audience prospects ready`, detail: 'Builders from YouTube, Hacker News and DEV with a confirmed business email.', href: '/audience/prospects?status=READY_TO_CONTACT', cta: 'Review', count: prospectsReady })
  if (callList) moves.push({ id: 'call', severity: 'normal', title: `${callList} good-fit businesses to call`, detail: 'No email anywhere, but a strong fit and a phone number. Export the call list.', href: '/finder?status=CALL', cta: 'Call list', count: callList })

  if (!senders) moves.push({ id: 'setup-sender', severity: 'setup', title: 'Connect a Gmail inbox', detail: 'Nothing can be sent until at least one inbox is connected.', href: '/sender-accounts', cta: 'Connect' })
  if (!settings.senderAddress) moves.push({ id: 'setup-address', severity: 'setup', title: 'Add your postal address', detail: 'Required in cold-email footers (CAN-SPAM, CASL, Spam Act).', href: '/settings', cta: 'Settings' })
  if (!googleConfigured()) moves.push({ id: 'setup-google', severity: 'setup', title: 'Add a Google Places key', detail: 'Unlocks Google Maps search with ratings and hours (about 20,000 businesses a month free). OpenStreetMap works without it.', href: '/finder', cta: 'How' })
  if (!verifierProvider()) moves.push({ id: 'setup-verifier', severity: 'setup', title: 'Add an email verifier key', detail: 'Lets the system confirm guessed addresses (owner@, info@): typically 2–3× more reachable leads, fewer bounces.', href: '/finder', cta: 'Why' })
  if (!searchProvider()) moves.push({ id: 'setup-search', severity: 'setup', title: 'Add a web-search key', detail: 'Serper (2,500 free) finds emails published outside a business\'s own site.', href: '/finder', cta: 'Why' })
  return moves
}

/** 30-day funnel across both sources */
export async function funnel30() {
  const since = new Date(Date.now() - 30 * 86_400_000)
  const [businesses, prospects, readyB, readyP, contacted, replied, interested, meetings, won] = await Promise.all([
    prisma.business.count({ where: { createdAt: { gte: since } } }),
    prisma.prospect.count({ where: { createdAt: { gte: since }, relevance: { in: ['HIGH', 'MEDIUM'] } } }),
    prisma.business.count({ where: { createdAt: { gte: since }, status: { in: ['READY', 'IN_CAMPAIGN'] } } }),
    prisma.prospect.count({ where: { createdAt: { gte: since }, status: { in: ['READY_TO_CONTACT', 'IN_CAMPAIGN'] } } }),
    prisma.lead.count({ where: { firstEmailSentAt: { gte: since } } }),
    prisma.lead.count({ where: { firstEmailSentAt: { gte: since }, hasReplied: true } }),
    prisma.lead.count({ where: { firstEmailSentAt: { gte: since }, isInterested: true } }),
    prisma.lead.count({ where: { firstEmailSentAt: { gte: since }, meetingBooked: true } }),
    prisma.lead.count({ where: { firstEmailSentAt: { gte: since }, hasSale: true } }),
  ])
  return [
    { key: 'found', label: 'Found', value: businesses + prospects },
    { key: 'ready', label: 'Reachable', value: readyB + readyP },
    { key: 'contacted', label: 'Emailed', value: contacted },
    { key: 'replied', label: 'Replied', value: replied },
    { key: 'interested', label: 'Interested', value: interested },
    { key: 'meetings', label: 'Meetings', value: meetings },
    { key: 'won', label: 'Won', value: won },
  ]
}

/** Emails sent and replies per day, last 14 days */
export async function activity14() {
  const since = new Date(Date.now() - 13 * 86_400_000); since.setHours(0, 0, 0, 0)
  const [out, inb] = await Promise.all([
    prisma.emailMessage.findMany({ where: { direction: 'OUTBOUND', sentAt: { gte: since } }, select: { sentAt: true } }),
    prisma.emailMessage.findMany({ where: { direction: 'INBOUND', receivedAt: { gte: since } }, select: { receivedAt: true } }),
  ])
  const days: Array<{ day: string; sent: number; replies: number }> = []
  for (let i = 0; i < 14; i++) {
    const d = new Date(since.getTime() + i * 86_400_000)
    days.push({ day: d.toISOString().slice(0, 10), sent: 0, replies: 0 })
  }
  const idx = (d: Date | null) => (d ? Math.floor((d.getTime() - since.getTime()) / 86_400_000) : -1)
  for (const m of out) { const i = idx(m.sentAt); if (days[i]) days[i].sent++ }
  for (const m of inb) { const i = idx(m.receivedAt); if (days[i]) days[i].replies++ }
  return days
}
