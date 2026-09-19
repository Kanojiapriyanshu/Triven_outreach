import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') || ''
  const status = searchParams.get('status') || ''
  const campaignId = searchParams.get('campaignId') || ''
  const senderAccountId = searchParams.get('senderAccountId') || ''

  const where: Record<string, unknown> = {}
  if (q) where.OR = [
    { companyName: { contains: q, mode: 'insensitive' } },
    { companyEmail: { contains: q, mode: 'insensitive' } },
  ]
  if (status) where.status = status
  if (campaignId) where.campaignId = campaignId
  if (senderAccountId) where.senderAccountId = senderAccountId

  const leads = await prisma.lead.findMany({
    where,
    include: {
      campaign: { select: { name: true } },
      senderAccount: { select: { email: true, displayName: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const rows = [
    // Headers
    ['Full Name', 'Company', 'Email', 'Phone', 'Website', 'LinkedIn', 'Industry', 'Country', 'State', 'City',
     'Campaign', 'Sender', 'Status', 'Priority', 'First Email Sent', 'FU1 Sent', 'FU2 Sent', 'FU3 Sent',
     'Replied', 'Interested', 'Demo Sent', 'Meeting Booked', 'Sale', 'Deal Value', 'Notes', 'Created'].join(','),
    ...leads.map((l) => [
      `"${[l.firstName, l.lastName].filter(Boolean).join(' ') || l.fullName || ''}"`,
      `"${l.companyName}"`,
      l.companyEmail || '',
      l.phone || '',
      l.website || '',
      l.linkedIn || '',
      l.industry || '',
      l.country || '',
      l.state || '',
      l.city || '',
      `"${l.campaign?.name || ''}"`,
      l.senderAccount?.email || '',
      l.status,
      l.priority,
      l.firstEmailSentAt?.toISOString().slice(0, 10) || '',
      l.followUp1SentAt?.toISOString().slice(0, 10) || '',
      l.followUp2SentAt?.toISOString().slice(0, 10) || '',
      l.followUp3SentAt?.toISOString().slice(0, 10) || '',
      l.hasReplied ? 'Yes' : 'No',
      l.isInterested ? 'Yes' : 'No',
      l.demoSent ? 'Yes' : 'No',
      l.meetingBooked ? 'Yes' : 'No',
      l.hasSale ? 'Yes' : 'No',
      l.dealValue?.toString() || '',
      `"${(l.notes || '').replace(/"/g, '""')}"`,
      l.createdAt.toISOString().slice(0, 10),
    ].join(',')),
  ].join('\n')

  return new NextResponse(rows, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
