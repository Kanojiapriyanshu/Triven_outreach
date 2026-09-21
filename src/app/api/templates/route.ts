import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { templateSchema, clearOtherDefaults } from '@/lib/email-templates'

export async function GET(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const campaignId = searchParams.get('campaignId')
  const type = searchParams.get('type')

  const templates = await prisma.emailTemplate.findMany({
    where: {
      ...(campaignId ? { campaignId } : {}),
      ...(type ? { type } : {}),
    },
    include: { campaign: { select: { id: true, name: true } } },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  })

  return NextResponse.json(templates)
}

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = templateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })

  const data = { ...parsed.data, campaignId: parsed.data.campaignId || null }
  const template = await prisma.emailTemplate.create({ data })
  if (template.isDefault) await clearOtherDefaults(template.type, template.campaignId, template.id)
  return NextResponse.json(template, { status: 201 })
}
