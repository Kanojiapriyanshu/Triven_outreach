import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { forgetProspects } from '@/lib/audience/actions'
import { updateStatus, bestEmail, readinessGap } from '@/lib/audience/pipeline'
import { getAudienceSettings } from '@/lib/audience/settings'
import { CONSENT_SENSITIVE, regionOf } from '@/lib/audience/taxonomy'

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const p = await prisma.prospect.findUnique({
    where: { id },
    include: {
      emails: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
      comments: { orderBy: { score: 'desc' }, take: 50, include: { video: { select: { title: true, youtubeVideoId: true, platform: true, channel: { select: { title: true } } } } } },
      lead: { select: { id: true, status: true, firstEmailSentAt: true, hasReplied: true, campaign: { select: { id: true, name: true } } } },
    },
  })
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const settings = await getAudienceSettings()
  const best = bestEmail(p.emails, p, settings)
  return NextResponse.json({ ...p, sendableEmailId: best?.id || null, readinessGap: p.lead ? null : readinessGap(p, settings), settings: { sendPolicy: settings.sendPolicy, strictRegions: settings.strictRegions } })
}

const patchSchema = z.object({
  firstName: z.string().trim().max(60).nullish(),
  lastName: z.string().trim().max(60).nullish(),
  company: z.string().trim().max(120).nullish(),
  jobTitle: z.string().trim().max(120).nullish(),
  website: z.string().trim().max(200).nullish(),
  linkedIn: z.string().trim().max(200).nullish(),
  country: z.string().trim().length(2).nullish().or(z.literal('')),
  persona: z.string().nullish(),
  interestCategory: z.string().nullish(),
  topic: z.string().trim().max(120).nullish(),
  icebreaker: z.string().trim().max(400).nullish(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  const d = parsed.data
  const country = d.country === undefined ? undefined : (d.country || null)?.toUpperCase() || null
  await prisma.prospect.update({
    where: { id },
    data: {
      ...Object.fromEntries(Object.entries(d).filter(([k, v]) => v !== undefined && k !== 'country').map(([k, v]) => [k, v || null])),
      ...(country !== undefined ? { country, region: regionOf(country), consentSensitive: !!country && CONSENT_SENSITIVE.has(country) } : {}),
      // Edited by hand: the AI shouldn't overwrite it
      ...(d.persona !== undefined || d.interestCategory !== undefined || d.topic !== undefined ? { aiCheckedAt: new Date() } : {}),
    },
  })
  await updateStatus(id)
  return NextResponse.json({ ok: true })
}

/** Data deletion: removes the person, their comments and CRM lead; their emails stay suppressed */
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  await forgetProspects([id])
  return NextResponse.json({ ok: true })
}
