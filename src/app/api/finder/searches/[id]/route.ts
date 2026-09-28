/**
 * POST   /api/finder/searches/:id { action: 'continue' | 'cancel' | 'rerun' }
 * DELETE /api/finder/searches/:id?businesses=1 → remove the search (and optionally its un-contacted businesses)
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { runSearch } from '@/lib/finder/pipeline'

export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { action } = await req.json().catch(() => ({})) as { action?: string }
  const search = await prisma.leadSearch.findUnique({ where: { id } })
  if (!search) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (action === 'cancel') return NextResponse.json(await prisma.leadSearch.update({ where: { id }, data: { status: 'CANCELLED', finishedAt: new Date() } }))
  if (action === 'rerun') {
    // Same search again: only businesses we don't know yet are added
    await prisma.leadSearch.update({ where: { id }, data: { status: 'QUEUED', cursor: { loc: 0 }, lastError: null, finishedAt: null } })
  } else if (search.status === 'ERROR') {
    await prisma.leadSearch.update({ where: { id }, data: { status: 'QUEUED', lastError: null } })
  }
  return NextResponse.json(await runSearch(id, Date.now() + 45_000))
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (new URL(req.url).searchParams.get('businesses') === '1') {
    await prisma.business.deleteMany({ where: { searchId: id, lead: null, status: { not: 'DO_NOT_CONTACT' } } })
  }
  await prisma.leadSearch.delete({ where: { id } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
