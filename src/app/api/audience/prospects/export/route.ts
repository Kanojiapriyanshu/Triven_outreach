import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { prospectWhere, prospectOrder } from '@/lib/audience/filters'
import { personaLabel, interestLabel, countryName, PROSPECT_STATUSES, type ProspectStatus } from '@/lib/audience/taxonomy'

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

  const rows = await prisma.prospect.findMany({
    where: prospectWhere(sp),
    orderBy: prospectOrder(sp.get('sort')),
    take: 20_000,
    include: {
      emails: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
      lead: { select: { status: true, campaign: { select: { name: true } } } },
      comments: { orderBy: { score: 'desc' }, take: 1, include: { video: { include: { channel: { select: { title: true } } } } } },
    },
  })

  const header = ['Name', 'YouTube profile', 'Source channel', 'Source video', 'Comment', 'Comment topic', 'Interest category', 'Persona', 'Relevance', 'Score',
    'Company', 'Job title', 'LinkedIn', 'Website', 'Email', 'Email status', 'Email source', 'Other emails', 'Location', 'Country', 'Why selected', 'Status', 'Campaign', 'First seen']
  const lines = [header.join(',')]
  for (const p of rows) {
    const best = p.comments[0]
    const primary = p.emails.find((e) => e.status !== 'INVALID') || p.emails[0]
    lines.push([
      p.firstName ? [p.firstName, p.lastName].filter(Boolean).join(' ') : p.displayName,
      `https://www.youtube.com/channel/${p.youtubeChannelId}`,
      best?.video.channel.title,
      best ? `https://www.youtube.com/watch?v=${best.video.youtubeVideoId}&lc=${best.youtubeCommentId}` : '',
      best?.text,
      p.topic,
      interestLabel(p.interestCategory),
      personaLabel(p.persona),
      p.relevance,
      p.score,
      p.company, p.jobTitle, p.linkedIn, p.website,
      primary?.email, primary?.status, primary?.source,
      p.emails.filter((e) => e !== primary).map((e) => `${e.email} (${e.status.toLowerCase()})`).join('; '),
      p.location,
      countryName(p.country),
      p.reason,
      p.lead?.status || PROSPECT_STATUSES[p.status as ProspectStatus] || p.status,
      p.lead?.campaign?.name,
      p.firstSeenAt,
    ].map(cell).join(','))
  }
  return new NextResponse('﻿' + lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="triven-prospects-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
