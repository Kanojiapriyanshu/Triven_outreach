import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { isTracked, notes } = await req.json() as { isTracked?: boolean; notes?: string }
  const c = await prisma.audienceChannel.update({
    where: { id },
    data: { ...(isTracked !== undefined ? { isTracked } : {}), ...(notes !== undefined ? { notes } : {}) },
  })
  return NextResponse.json({ ...c, viewCount: Number(c.viewCount) })
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  await prisma.audienceChannel.delete({ where: { id } }) // videos + comments cascade
  await prisma.prospect.deleteMany({ where: { comments: { none: {} }, lead: null, emails: { none: {} } } })
  return NextResponse.json({ ok: true })
}
