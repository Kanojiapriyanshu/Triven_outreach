import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const entries = await prisma.suppressionEntry.findMany({ orderBy: { addedAt: 'desc' }, take: 500 })
  return NextResponse.json(entries)
}

// Body: { value: "someone@x.com" | "x.com", reason? }
export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { value, reason } = await req.json() as { value?: string; reason?: string }
  const v = value?.trim().toLowerCase()
  if (!v || !/^[^\s@]+(@[^\s@]+)?\.[^\s@]+$/.test(v)) {
    return NextResponse.json({ error: 'Enter an email address or a domain' }, { status: 400 })
  }

  const isEmail = v.includes('@')
  const existing = await prisma.suppressionEntry.findFirst({ where: isEmail ? { email: v } : { domain: v } })
  const entry = existing ?? await prisma.suppressionEntry.create({
    data: isEmail ? { email: v, reason: reason || 'DO_NOT_CONTACT' } : { domain: v, reason: reason || 'DO_NOT_CONTACT' },
  })

  // Stop anything already queued for matching leads
  const leads = await prisma.lead.findMany({
    where: isEmail ? { companyEmail: v } : { companyEmail: { endsWith: `@${v}` } },
    select: { id: true },
  })
  if (leads.length) {
    const ids = leads.map((l) => l.id)
    await prisma.followUpTask.updateMany({ where: { leadId: { in: ids }, status: 'PENDING' }, data: { status: 'CANCELLED' } })
    await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { status: 'DO_NOT_CONTACT', nextFollowUpAt: null } })
  }
  return NextResponse.json({ ...entry, leadsStopped: leads.length }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  await prisma.suppressionEntry.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
