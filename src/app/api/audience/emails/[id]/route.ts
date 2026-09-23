import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { updateStatus } from '@/lib/audience/pipeline'

/** { isPrimary: true } makes this the address used for outreach; { status: 'INVALID' } rules it out */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { isPrimary, status } = await req.json() as { isPrimary?: boolean; status?: string }
  const email = await prisma.prospectEmail.findUnique({ where: { id } })
  if (!email) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (isPrimary) {
    await prisma.prospectEmail.updateMany({ where: { prospectId: email.prospectId }, data: { isPrimary: false } })
    await prisma.prospectEmail.update({ where: { id }, data: { isPrimary: true } })
  }
  if (status === 'INVALID') {
    await prisma.prospectEmail.update({ where: { id }, data: { status: 'INVALID', verifyMethod: 'MANUAL', verifyDetail: 'marked invalid by hand', checkedAt: new Date(), isPrimary: false } })
  }
  if (status === 'RECHECK') {
    await prisma.prospectEmail.update({ where: { id }, data: { checkedAt: null } })
  }
  await updateStatus(email.prospectId)
  return NextResponse.json({ ok: true })
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const email = await prisma.prospectEmail.delete({ where: { id } })
  await updateStatus(email.prospectId)
  return NextResponse.json({ ok: true })
}
