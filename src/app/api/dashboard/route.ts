import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { startOfDay, endOfDay } from 'date-fns'

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const todayStart = startOfDay(new Date())
  const todayEnd = endOfDay(new Date())

  const [
    newLeads,
    firstEmailsDue,
    followUpsDueToday,
    overdueFollowUps,
    repliesToday,
    interestedLeads,
    demosToday,
    meetingsToday,
    wonToday,
    revenueToday,
    totalLeads,
    totalReplied,
    totalInterested,
    totalWon,
    totalLost,
    totalRevenue,
    senderAccounts,
  ] = await Promise.all([
    // Today's new leads
    prisma.lead.count({
      where: { createdAt: { gte: todayStart, lte: todayEnd } },
    }),
    // First emails due today
    prisma.lead.count({
      where: {
        status: 'READY_TO_CONTACT',
        OR: [
          { nextFollowUpAt: { gte: todayStart, lte: todayEnd } },
          { nextFollowUpAt: null },
        ],
      },
    }),
    // Follow-ups due today
    prisma.followUpTask.count({
      where: {
        status: 'PENDING',
        scheduledAt: { gte: todayStart, lte: todayEnd },
      },
    }),
    // Overdue follow-ups
    prisma.followUpTask.count({
      where: {
        status: 'PENDING',
        scheduledAt: { lt: todayStart },
      },
    }),
    // Replies today
    prisma.activity.count({
      where: { type: 'EMAIL_REPLIED', createdAt: { gte: todayStart, lte: todayEnd } },
    }),
    // Interested leads (all time count for today context)
    prisma.lead.count({ where: { isInterested: true } }),
    // Demos sent today
    prisma.activity.count({
      where: { type: 'DEMO_SENT', createdAt: { gte: todayStart, lte: todayEnd } },
    }),
    // Meetings today
    prisma.lead.count({
      where: { meetingDate: { gte: todayStart, lte: todayEnd } },
    }),
    // Won today
    prisma.lead.count({
      where: { hasSale: true, saleDate: { gte: todayStart, lte: todayEnd } },
    }),
    // Revenue today
    prisma.lead.aggregate({
      where: { hasSale: true, saleDate: { gte: todayStart, lte: todayEnd } },
      _sum: { dealValue: true },
    }),
    // Total leads
    prisma.lead.count(),
    // Total replied
    prisma.lead.count({ where: { hasReplied: true } }),
    // Total interested
    prisma.lead.count({ where: { isInterested: true } }),
    // Total won
    prisma.lead.count({ where: { hasSale: true } }),
    // Total lost
    prisma.lead.count({ where: { status: { in: ['LOST', 'NOT_INTERESTED'] } } }),
    // Total revenue
    prisma.lead.aggregate({
      where: { hasSale: true },
      _sum: { dealValue: true },
    }),
    // Sender accounts with stats
    prisma.senderAccount.findMany({
      where: { isActive: true },
      select: {
        id: true,
        displayName: true,
        email: true,
        gmailStatus: true,
        dailyEmailTarget: true,
        _count: { select: { leads: true } },
      },
    }),
  ])

  // Per-sender today stats
  const senderStats = await Promise.all(
    senderAccounts.map(async (sa) => {
      const [newEmails, followUps] = await Promise.all([
        prisma.activity.count({
          where: {
            senderAccountId: sa.id,
            type: 'EMAIL_SENT',
            createdAt: { gte: todayStart, lte: todayEnd },
          },
        }),
        prisma.activity.count({
          where: {
            senderAccountId: sa.id,
            type: 'FOLLOW_UP_SENT',
            createdAt: { gte: todayStart, lte: todayEnd },
          },
        }),
      ])
      return {
        id: sa.id,
        displayName: sa.displayName,
        email: sa.email,
        gmailStatus: sa.gmailStatus,
        dailyEmailTarget: sa.dailyEmailTarget,
        todayNewEmails: newEmails,
        todayFollowUps: followUps,
        todayReplies: 0,
        todayInterested: 0,
        totalLeads: sa._count.leads,
      }
    })
  )

  return NextResponse.json({
    today: {
      newLeads,
      firstEmailsDue,
      followUpsDue: followUpsDueToday,
      overdue: overdueFollowUps,
      replies: repliesToday,
      interested: interestedLeads,
      demos: demosToday,
      meetings: meetingsToday,
      won: wonToday,
      revenue: Number(revenueToday._sum.dealValue ?? 0),
    },
    totals: {
      leads: totalLeads,
      active: totalLeads - totalWon - totalLost,
      replied: totalReplied,
      interested: totalInterested,
      won: totalWon,
      lost: totalLost,
      revenue: Number(totalRevenue._sum.dealValue ?? 0),
    },
    senderStats,
  })
}
