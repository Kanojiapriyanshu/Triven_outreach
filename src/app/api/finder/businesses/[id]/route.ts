/**
 * GET    /api/finder/businesses/:id → full record with every email and where it came from
 * PATCH  /api/finder/businesses/:id { ownerName?, notes?, addEmail?, primaryEmailId?, removeEmailId?, status? }
 * DELETE /api/finder/businesses/:id
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { rescore, isSendable } from '@/lib/finder/pipeline'
import { getFinderSettings } from '@/lib/finder/settings'
import { emailTraits, isUsableEmail, normalizeEmail, verifyEmail } from '@/lib/audience/verify'
import { nicheOf } from '@/lib/finder/niches'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const [b, s] = await Promise.all([
    prisma.business.findUnique({
      where: { id },
      include: {
        emails: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        lead: { select: { id: true, status: true, campaign: { select: { id: true, name: true } } } },
        search: { select: { id: true, query: true, locations: true } },
      },
    }),
    getFinderSettings(),
  ])
  if (!b) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ...b, nicheLabel: nicheOf(b.niche)?.label || null, emails: b.emails.map((e) => ({ ...e, sendable: isSendable(e, s) })) })
}

const patch = z.object({
  ownerName: z.string().trim().max(80).nullish(),
  notes: z.string().max(4000).nullish(),
  addEmail: z.string().trim().optional(),
  primaryEmailId: z.string().optional(),
  removeEmailId: z.string().optional(),
  status: z.enum(['EXCLUDED', 'DO_NOT_CONTACT', 'RESTORE']).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const parsed = patch.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  const d = parsed.data
  const b = await prisma.business.findUnique({ where: { id } })
  if (!b) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (d.ownerName !== undefined || d.notes !== undefined) {
    await prisma.business.update({
      where: { id },
      data: {
        ...(d.ownerName !== undefined ? { ownerName: d.ownerName || null, ownerSource: d.ownerName ? 'Entered by you' : null } : {}),
        ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
      },
    })
  }
  if (d.addEmail) {
    const email = normalizeEmail(d.addEmail)
    if (!isUsableEmail(email)) return NextResponse.json({ error: 'That is not a usable email address' }, { status: 400 })
    const v = await verifyEmail(email)
    const t = emailTraits(email)
    await prisma.businessEmail.upsert({
      where: { businessId_email: { businessId: id, email } },
      create: { businessId: id, email, source: 'MANUAL', status: v.status, verifyMethod: v.method, verifyDetail: v.detail.slice(0, 250), isRole: t.isRole, isFree: t.isFree, checkedAt: new Date() },
      update: {},
    })
    if (!b.enrichedAt) await prisma.business.update({ where: { id }, data: { enrichedAt: new Date() } })
  }
  if (d.primaryEmailId) {
    await prisma.businessEmail.updateMany({ where: { businessId: id }, data: { isPrimary: false } })
    await prisma.businessEmail.update({ where: { id: d.primaryEmailId }, data: { isPrimary: true } })
  }
  if (d.removeEmailId) await prisma.businessEmail.delete({ where: { id: d.removeEmailId } }).catch(() => null)
  if (d.status === 'DO_NOT_CONTACT') {
    const emails = await prisma.businessEmail.findMany({ where: { businessId: id }, select: { email: true } })
    for (const { email } of emails) {
      const exists = await prisma.suppressionEntry.findFirst({ where: { email } })
      if (!exists) await prisma.suppressionEntry.create({ data: { email, reason: 'DO_NOT_CONTACT' } })
    }
    await prisma.business.update({ where: { id }, data: { status: 'DO_NOT_CONTACT', excludeReason: 'Do not contact' } })
  } else if (d.status === 'EXCLUDED') {
    await prisma.business.update({ where: { id }, data: { status: 'EXCLUDED', excludeReason: 'Excluded by you' } })
  } else if (d.status === 'RESTORE') {
    // Back in play; rescore puts it in the right place (NEW / READY / NO_EMAIL …)
    await prisma.business.update({ where: { id }, data: { status: b.enrichedAt ? 'NO_EMAIL' : 'NEW', excludeReason: null, isChain: false } })
  }
  await rescore(id)
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  await prisma.business.delete({ where: { id } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
