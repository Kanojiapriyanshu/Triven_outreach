import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

// GET /api/leads/ids?q=&status=&campaignId=&senderAccountId=
// Every lead id matching the Leads page filters, for "Select all N leads"
export async function GET(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const q = sp.get('q') || ''
  const where: Prisma.LeadWhereInput = {
    ...(q ? {
      OR: [
        { companyName: { contains: q, mode: 'insensitive' } },
        { fullName: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { companyEmail: { contains: q, mode: 'insensitive' } },
        { website: { contains: q, mode: 'insensitive' } },
      ],
    } : {}),
    ...(sp.get('status') ? { status: sp.get('status')! } : {}),
    ...(sp.get('campaignId') ? { campaignId: sp.get('campaignId')! } : {}),
    ...(sp.get('senderAccountId') ? { senderAccountId: sp.get('senderAccountId')! } : {}),
  }
  const leads = await prisma.lead.findMany({ where, select: { id: true }, take: 20000 })
  return NextResponse.json({ ids: leads.map((l) => l.id) })
}
