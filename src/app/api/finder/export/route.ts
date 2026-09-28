/** GET /api/finder/export?<list filters> → CSV (status=CALL gives the phone call list) */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { businessWhere, businessOrder } from '@/lib/finder/filters'
import { bestBizEmail } from '@/lib/finder/pipeline'
import { getFinderSettings } from '@/lib/finder/settings'
import { nicheOf } from '@/lib/finder/niches'

/** RFC 4180 cell: quote when needed, double embedded quotes, neutralise spreadsheet formulas */
function cell(v: unknown) {
  if (v == null) return ''
  let s = v instanceof Date ? v.toISOString().slice(0, 16).replace('T', ' ') : String(v)
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const s = await getFinderSettings()
  const rows = await prisma.business.findMany({ where: businessWhere(sp), orderBy: businessOrder(sp.get('sort')), take: 20_000, include: { emails: true } })
  const header = ['Business', 'Niche', 'Category', 'Fit', 'Tier', 'Status', 'Owner / doctor', 'Owner title', 'Email', 'Email status', 'Email source', 'Other emails', 'Phone', 'Website', 'Contact form',
    'Address', 'City', 'State', 'Country', 'Rating', 'Reviews', 'Hours', 'Site facts', 'Tools on site', 'Why', 'Map listing', 'LinkedIn', 'Facebook', 'Instagram', 'Where we looked']
  const lines = [header.join(',')]
  for (const b of rows) {
    const best = bestBizEmail(b.emails, s) || b.emails.find((e) => e.status !== 'INVALID')
    lines.push([
      b.name, nicheOf(b.niche)?.label, b.category, b.fitScore, b.tier, b.status, b.ownerName, b.ownerTitle,
      best?.email, best?.status, best?.source, b.emails.filter((e) => e !== best).map((e) => `${e.email} (${e.status.toLowerCase()})`).join('; '),
      b.phone, b.website, b.contactFormUrl, b.address, b.city, b.state, b.country, b.rating, b.reviewCount, b.hours,
      b.siteFacts.join('; '), b.techSignals.join('; '), b.fitReasons.join('; '), b.mapsUrl, b.linkedIn, b.facebook, b.instagram, b.searchLog?.replace(/\n/g, ' | '),
    ].map(cell).join(','))
  }
  const name = sp.get('status') === 'CALL' ? 'call-list' : 'businesses'
  return new NextResponse(`﻿${lines.join('\r\n')}`, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"` },
  })
}
