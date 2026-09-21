import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

/** RFC 4180 cell: quote when needed, double embedded quotes, neutralise spreadsheet formulas */
function cell(v: unknown) {
  if (v == null) return ''
  let s = v instanceof Date ? v.toISOString().slice(0, 16).replace('T', ' ') : String(v)
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const yes = (b: boolean) => (b ? 'Yes' : 'No')

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
    { fullName: { contains: q, mode: 'insensitive' } },
    { companyEmail: { contains: q, mode: 'insensitive' } },
    { website: { contains: q, mode: 'insensitive' } },
  ]
  if (status) where.status = status
  if (campaignId) where.campaignId = campaignId
  if (senderAccountId) where.senderAccountId = senderAccountId

  const leads = await prisma.lead.findMany({
    where,
    include: {
      campaign: { select: { name: true } },
      senderAccount: { select: { email: true } },
    },
    orderBy: [{ companyName: 'asc' }],
  })

  const columns: Array<[string, (l: typeof leads[number]) => unknown]> = [
    ['Company', (l) => l.companyName],
    ['Contact', (l) => l.fullName || [l.firstName, l.lastName].filter(Boolean).join(' ')],
    ['First Name', (l) => l.firstName],
    ['Email', (l) => l.companyEmail],
    ['Phone', (l) => l.phone],
    ['Website', (l) => l.website],
    ['City', (l) => l.city],
    ['State', (l) => l.state],
    ['Country', (l) => l.country],
    ['Industry', (l) => l.industry],
    ['Niche / Campaign', (l) => l.campaign?.name],
    ['Sender', (l) => l.senderAccount?.email],
    ['Status', (l) => l.status.replace(/_/g, ' ')],
    ['Priority', (l) => l.priority],
    ['First Email Sent', (l) => l.firstEmailSentAt],
    ['Follow-up 1 Sent', (l) => l.followUp1SentAt],
    ['Follow-up 2 Sent', (l) => l.followUp2SentAt],
    ['Follow-up 3 Sent', (l) => l.followUp3SentAt],
    ['Next Scheduled', (l) => l.nextFollowUpAt],
    ['Last Contacted', (l) => l.lastContactedAt],
    ['Replied', (l) => yes(l.hasReplied)],
    ['Replied At', (l) => l.lastResponseAt],
    ['Interested', (l) => yes(l.isInterested)],
    ['Meeting Booked', (l) => yes(l.meetingBooked)],
    ['Won', (l) => yes(l.hasSale)],
    ['Deal Value', (l) => l.dealValue?.toString()],
    ['Why This Lead', (l) => l.whyThisLead],
    ['Personal Note', (l) => l.personalizationNotes],
    ['Notes', (l) => l.notes],
    ['Source', (l) => l.leadSource],
    ['Created', (l) => l.createdAt],
  ]

  const csv = [
    columns.map(([h]) => cell(h)).join(','),
    ...leads.map((l) => columns.map(([, get]) => cell(get(l))).join(',')),
  ].join('\r\n')

  // BOM so Excel opens UTF-8 (names with accents, em dashes) correctly
  return new NextResponse('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="triven-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
