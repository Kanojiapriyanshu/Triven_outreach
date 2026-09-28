// Daily digest (PRD R11.2): one in-app notification each morning with yesterday's numbers.
import prisma from './prisma'
import { notify } from './notify'

export async function dailyDigest() {
  const since = new Date(Date.now() - 86_400_000)
  const [sent, replies, positive, meetings, newReady, newBusinesses, top] = await Promise.all([
    prisma.emailMessage.count({ where: { direction: 'OUTBOUND', sentAt: { gte: since } } }),
    prisma.emailMessage.count({ where: { direction: 'INBOUND', receivedAt: { gte: since } } }),
    prisma.lead.count({ where: { replyCategory: { in: ['INTERESTED', 'MEETING'] }, lastResponseAt: { gte: since } } }),
    prisma.activity.count({ where: { type: 'MEETING_BOOKED', createdAt: { gte: since } } }),
    prisma.prospect.count({ where: { status: 'READY_TO_CONTACT', updatedAt: { gte: since } } }),
    prisma.business.count({ where: { status: 'READY', updatedAt: { gte: since } } }),
    prisma.sourceSnapshot.findFirst({ where: { contentId: '', date: { gte: new Date(Date.now() - 2 * 86_400_000) } }, orderBy: [{ replied: 'desc' }, { qra: 'desc' }], select: { title: true, replied: true, qra: true } }),
  ])
  const parts = [
    `${sent} sent`, `${replies} repl${replies === 1 ? 'y' : 'ies'}${positive ? ` (${positive} positive)` : ''}`,
    meetings ? `${meetings} meeting${meetings === 1 ? '' : 's'} booked` : '',
    `${newReady + newBusinesses} newly ready to email`,
  ].filter(Boolean)
  await notify({
    type: 'SYSTEM', title: `Yesterday: ${parts.join(' · ')}`,
    body: top?.title ? `Best source: ${top.title} (${top.qra} reachable, ${top.replied} replies)` : 'Open the dashboard for today\'s next moves.',
    href: '/', group: `digest:${new Date().toISOString().slice(0, 10)}`,
  })
  return { sent, replies, positive, meetings, newReady, newBusinesses }
}
