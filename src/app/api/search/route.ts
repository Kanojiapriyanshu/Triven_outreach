/** GET /api/search?q= → quick results across leads, Lead Finder businesses and audience prospects */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const q = new URL(req.url).searchParams.get('q')?.trim() || ''
  if (q.length < 2) return NextResponse.json({ leads: [], businesses: [], prospects: [] })
  const c = { contains: q, mode: 'insensitive' as const }
  const [leads, businesses, prospects] = await Promise.all([
    prisma.lead.findMany({
      where: { OR: [{ companyName: c }, { fullName: c }, { companyEmail: c }, { city: c }] },
      select: { id: true, companyName: true, fullName: true, companyEmail: true, status: true }, take: 6, orderBy: { updatedAt: 'desc' },
    }),
    prisma.business.findMany({
      where: { OR: [{ name: c }, { domain: c }, { ownerName: c }, { city: c }] },
      select: { id: true, name: true, city: true, state: true, status: true }, take: 6, orderBy: { fitScore: 'desc' },
    }),
    prisma.prospect.findMany({
      where: { OR: [{ displayName: c }, { company: c }, { website: c }, { emails: { some: { email: c } } }] },
      select: { id: true, displayName: true, company: true, status: true }, take: 5, orderBy: { score: 'desc' },
    }),
  ])
  return NextResponse.json({ leads, businesses, prospects })
}
