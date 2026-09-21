import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { templateSchema, clearOtherDefaults } from '@/lib/email-templates'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = templateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })

  const { id } = await params
  const template = await prisma.emailTemplate.update({
    where: { id },
    data: { ...parsed.data, campaignId: parsed.data.campaignId || null },
  })
  if (template.isDefault) await clearOtherDefaults(template.type, template.campaignId, template.id)
  return NextResponse.json(template)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  await prisma.emailTemplate.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
