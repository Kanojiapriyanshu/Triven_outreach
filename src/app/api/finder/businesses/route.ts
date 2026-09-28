/** GET /api/finder/businesses?status=&tier=&niche=&search=&q=&sort=&page= */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { businessWhere, businessOrder } from '@/lib/finder/filters'
import { bestBizEmail } from '@/lib/finder/pipeline'
import { getFinderSettings } from '@/lib/finder/settings'

const PAGE = 50

export async function GET(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const page = Math.max(1, Number(sp.get('page') || 1))
  const where = businessWhere(sp)
  const [rows, total, s] = await Promise.all([
    prisma.business.findMany({
      where, orderBy: businessOrder(sp.get('sort')), skip: (page - 1) * PAGE, take: PAGE,
      include: { emails: true, lead: { select: { id: true, status: true, campaign: { select: { name: true } } } } },
    }),
    prisma.business.count({ where }),
    getFinderSettings(),
  ])
  const items = rows.map(({ emails, ...b }) => {
    const best = bestBizEmail(emails, s)
    const shown = best || emails.find((e) => e.status !== 'INVALID') || null
    return {
      ...b,
      email: shown && { email: shown.email, status: shown.status, source: shown.source, isRole: shown.isRole, sendable: !!best, personName: shown.personName },
      emailCount: emails.length,
    }
  })
  return NextResponse.json({ items, total, page, pages: Math.max(1, Math.ceil(total / PAGE)) })
}
