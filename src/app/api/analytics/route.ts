import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { subDays, startOfDay, endOfDay, format } from 'date-fns'

export async function GET(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const days = parseInt(searchParams.get('days') || '30', 10)
  const since = startOfDay(subDays(new Date(), days))

  const [
    campaignStats,
    senderStats,
    industryStats,
    statusDistribution,
    dailyActivity,
    conversionFunnel,
  ] = await Promise.all([
    // Per-campaign stats
    prisma.campaign.findMany({
      select: {
        id: true,
        name: true,
        industry: true,
        _count: { select: { leads: true } },
        leads: {
          select: {
            hasReplied: true, isInterested: true, demoSent: true,
            meetingBooked: true, hasSale: true, dealValue: true,
          },
        },
      },
    }),
    // Per-sender stats
    prisma.senderAccount.findMany({
      select: {
        id: true,
        displayName: true,
        email: true,
        dailyEmailTarget: true,
        leads: {
          select: {
            hasReplied: true, isInterested: true, demoSent: true,
            meetingBooked: true, hasSale: true, dealValue: true,
          },
        },
        activities: {
          where: { createdAt: { gte: since }, type: { in: ['EMAIL_SENT', 'FOLLOW_UP_SENT'] } },
          select: { type: true },
        },
      },
    }),
    // By industry
    prisma.lead.groupBy({
      by: ['industry'],
      _count: { id: true },
      _sum: { dealValue: true },
      where: { industry: { not: null } },
    }),
    // Status distribution
    prisma.lead.groupBy({
      by: ['status'],
      _count: { id: true },
    }),
    // Daily activity (last N days)
    prisma.activity.groupBy({
      by: ['type', 'createdAt'],
      where: { createdAt: { gte: since } },
      _count: { id: true },
    }),
    // Conversion funnel
    Promise.all([
      prisma.lead.count(),
      prisma.lead.count({ where: { firstEmailSentAt: { not: null } } }),
      prisma.lead.count({ where: { hasReplied: true } }),
      prisma.lead.count({ where: { isInterested: true } }),
      prisma.lead.count({ where: { demoSent: true } }),
      prisma.lead.count({ where: { meetingBooked: true } }),
      prisma.lead.count({ where: { hasSale: true } }),
    ]),
  ])

  // Build daily trend data
  const dailyMap: Record<string, { date: string; sent: number; replies: number }> = {}
  for (let i = days; i >= 0; i--) {
    const d = format(subDays(new Date(), i), 'yyyy-MM-dd')
    dailyMap[d] = { date: d, sent: 0, replies: 0 }
  }
  for (const a of dailyActivity) {
    const d = format(a.createdAt, 'yyyy-MM-dd')
    if (!dailyMap[d]) continue
    if (a.type === 'EMAIL_SENT' || a.type === 'FOLLOW_UP_SENT') dailyMap[d].sent += a._count.id
    if (a.type === 'EMAIL_REPLIED') dailyMap[d].replies += a._count.id
  }

  const [total, contacted, replied, interested, demoCount, meetings, won] = conversionFunnel

  return NextResponse.json({
    funnel: [
      { stage: 'Total Leads', count: total },
      { stage: 'Contacted', count: contacted },
      { stage: 'Replied', count: replied },
      { stage: 'Interested', count: interested },
      { stage: 'Demo', count: demoCount },
      { stage: 'Meeting', count: meetings },
      { stage: 'Won', count: won },
    ],
    campaigns: campaignStats.map((c) => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      totalLeads: c._count.leads,
      replied: c.leads.filter((l) => l.hasReplied).length,
      interested: c.leads.filter((l) => l.isInterested).length,
      demos: c.leads.filter((l) => l.demoSent).length,
      meetings: c.leads.filter((l) => l.meetingBooked).length,
      won: c.leads.filter((l) => l.hasSale).length,
      revenue: c.leads.reduce((s, l) => s + Number(l.dealValue ?? 0), 0),
      replyRate: c._count.leads > 0 ? ((c.leads.filter((l) => l.hasReplied).length / c._count.leads) * 100).toFixed(1) : '0',
    })),
    senders: senderStats.map((s) => ({
      id: s.id,
      displayName: s.displayName,
      email: s.email,
      dailyEmailTarget: s.dailyEmailTarget,
      totalLeads: s.leads.length,
      emailsSent: s.activities.filter((a) => a.type === 'EMAIL_SENT').length,
      followUpsSent: s.activities.filter((a) => a.type === 'FOLLOW_UP_SENT').length,
      replied: s.leads.filter((l) => l.hasReplied).length,
      interested: s.leads.filter((l) => l.isInterested).length,
      won: s.leads.filter((l) => l.hasSale).length,
      revenue: s.leads.reduce((acc, l) => acc + Number(l.dealValue ?? 0), 0),
    })),
    industries: industryStats.map((i) => ({
      industry: i.industry || 'Unknown',
      count: i._count.id,
      revenue: Number(i._sum.dealValue ?? 0),
    })).sort((a, b) => b.count - a.count),
    statusDistribution: statusDistribution.map((s) => ({
      status: s.status,
      count: s._count.id,
    })),
    dailyTrend: Object.values(dailyMap),
  })
}
