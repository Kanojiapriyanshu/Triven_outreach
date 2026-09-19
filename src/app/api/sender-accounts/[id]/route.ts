import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const account = await prisma.senderAccount.findUnique({
    where: { id },
    include: { _count: { select: { leads: true } } },
  })

  if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Never expose tokens
  const { accessToken: _, refreshToken: __, ...safe } = account
  return NextResponse.json(safe)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  // Never allow patching tokens through this route
  const { accessToken: _, refreshToken: __, tokenExpiresAt: ___, ...safe } = body

  const account = await prisma.senderAccount.update({ where: { id }, data: safe })
  const { accessToken: _a, refreshToken: _r, ...safeResult } = account
  return NextResponse.json(safeResult)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  await prisma.senderAccount.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
