import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { addDays } from 'date-fns'

const createLeadSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  fullName: z.string().optional(),
  jobTitle: z.string().optional(),
  companyName: z.string().min(1),
  website: z.string().optional(),
  companyEmail: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  linkedIn: z.string().optional(),
  country: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  industry: z.string().optional(),
  subIndustry: z.string().optional(),
  companySize: z.string().optional(),
  notes: z.string().optional(),
  campaignId: z.string().optional(),
  leadSource: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  senderAccountId: z.string().optional(),
  personalizationNotes: z.string().optional(),
  companyPainPoint: z.string().optional(),
  whyThisLead: z.string().optional(),
  researchSummary: z.string().optional(),
  prospectingNotes: z.string().optional(),
  firstEmailSubject: z.string().optional(),
  firstEmailBody: z.string().optional(),
})

export async function GET(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') || '1', 10)
  const pageSize = Math.min(parseInt(searchParams.get('pageSize') || '50', 10), 200)
  const q = searchParams.get('q') || ''
  const status = searchParams.get('status') || ''
  const campaignId = searchParams.get('campaignId') || ''
  const senderAccountId = searchParams.get('senderAccountId') || ''
  const industry = searchParams.get('industry') || ''
  const priority = searchParams.get('priority') || ''
  const hasReplied = searchParams.get('hasReplied')
  const isInterested = searchParams.get('isInterested')

  const where: Record<string, unknown> = {}

  if (q) {
    where.OR = [
      { companyName: { contains: q, mode: 'insensitive' } },
      { fullName: { contains: q, mode: 'insensitive' } },
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
      { companyEmail: { contains: q, mode: 'insensitive' } },
      { website: { contains: q, mode: 'insensitive' } },
    ]
  }
  if (status) where.status = status
  if (campaignId) where.campaignId = campaignId
  if (senderAccountId) where.senderAccountId = senderAccountId
  if (industry) where.industry = { contains: industry, mode: 'insensitive' }
  if (priority) where.priority = priority
  if (hasReplied === 'true') where.hasReplied = true
  if (hasReplied === 'false') where.hasReplied = false
  if (isInterested === 'true') where.isInterested = true

  const [total, leads] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      include: {
        campaign: { select: { id: true, name: true } },
        senderAccount: { select: { id: true, displayName: true, email: true } },
        assignedUser: { select: { id: true, name: true } },
      },
      orderBy: [{ nextFollowUpAt: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  return NextResponse.json({
    data: leads,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  })
}

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const data = createLeadSchema.parse(body)

    // Check for duplicate by email
    if (data.companyEmail) {
      const existing = await prisma.lead.findFirst({
        where: { companyEmail: data.companyEmail.toLowerCase() },
      })
      if (existing) {
        return NextResponse.json({ error: 'A lead with this email already exists', existingId: existing.id }, { status: 409 })
      }
    }

    // Get campaign follow-up config if campaign assigned
    let nextFollowUpAt: Date | undefined
    if (data.senderAccountId && data.campaignId) {
      const campaign = await prisma.campaign.findUnique({
        where: { id: data.campaignId },
        select: { followUpDay1: true },
      })
      if (campaign) {
        nextFollowUpAt = addDays(new Date(), campaign.followUpDay1)
      }
    }

    const lead = await prisma.lead.create({
      data: {
        ...data,
        companyEmail: data.companyEmail?.toLowerCase() || undefined,
        status: data.status || 'NEW',
        priority: data.priority || 'MEDIUM',
        leadSource: data.leadSource || 'MANUAL',
        assignedUserId: session.userId,
        nextFollowUpAt,
        fullName: data.fullName || [data.firstName, data.lastName].filter(Boolean).join(' ') || undefined,
      },
      include: {
        campaign: { select: { id: true, name: true } },
        senderAccount: { select: { id: true, displayName: true, email: true } },
      },
    })

    // Log activity
    await prisma.activity.create({
      data: {
        leadId: lead.id,
        userId: session.userId,
        type: 'NOTE_ADDED',
        title: 'Lead created',
        body: `Lead created by ${session.name}`,
      },
    })

    return NextResponse.json(lead, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error('[leads/POST]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
