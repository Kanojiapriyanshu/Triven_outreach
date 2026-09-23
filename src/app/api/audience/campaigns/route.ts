/**
 * GET  /api/audience/campaigns → the five AI Builder campaigns and whether they exist
 * POST /api/audience/campaigns → create the missing ones, each with its 4-step sequence
 */
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { AUDIENCE_CAMPAIGNS } from '@/lib/audience/actions'
import { AI_BUILDER_SEQUENCES } from '@/lib/audience/sequences'

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const existing = await prisma.campaign.findMany({
    where: { name: { in: AUDIENCE_CAMPAIGNS.map((c) => c.name) } },
    select: { id: true, name: true, sendingStatus: true, _count: { select: { leads: true, templates: true } } },
  })
  return NextResponse.json(AUDIENCE_CAMPAIGNS.map((c) => {
    const e = existing.find((x) => x.name === c.name)
    return { ...c, personas: [...c.personas], id: e?.id || null, sendingStatus: e?.sendingStatus || null, leads: e?._count.leads || 0, templates: e?._count.templates || 0 }
  }))
}

export async function POST() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let created = 0
  for (const c of AUDIENCE_CAMPAIGNS) {
    const exists = await prisma.campaign.findFirst({ where: { name: c.name } })
    if (exists) continue
    const seq = AI_BUILDER_SEQUENCES.find((s) => s.id === c.sequence)!
    await prisma.campaign.create({
      data: {
        name: c.name,
        industry: 'AI Builder',
        product: 'Triven AI Builder',
        description: `YouTube audience: ${seq.description}`,
        // Worldwide English-speaking audience: no country filter; the schedule comes from Settings
        targetCountry: null,
        followUpDay1: 3,
        followUpDay2: 7,
        followUpDay3: 14,
        dailyNewLeads: 30,
        sendingStatus: 'DRAFT',
        templates: {
          create: seq.steps.map((s) => ({ name: s.name, subject: s.subject, body: s.body, type: s.type, isDefault: true })),
        },
      },
    })
    created++
  }
  return NextResponse.json({ created })
}
