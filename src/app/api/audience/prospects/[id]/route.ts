import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { forgetProspects } from '@/lib/audience/actions'
import { updateStatus, bestEmail, readinessGap } from '@/lib/audience/pipeline'
import { getAudienceSettings } from '@/lib/audience/settings'
import { CONSENT_SENSITIVE, regionOf } from '@/lib/audience/taxonomy'
import { recomputeIntelligence } from '@/lib/audience/intelligence'

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const p = await prisma.prospect.findUnique({
    where: { id },
    include: {
      emails: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
      comments: { orderBy: { score: 'desc' }, take: 50, include: { video: { select: { title: true, youtubeVideoId: true, platform: true, url: true, channel: { select: { title: true } } } } } },
      lead: { select: { id: true, status: true, firstEmailSentAt: true, hasReplied: true, campaign: { select: { id: true, name: true } } } },
      evidence: { orderBy: [{ weight: 'desc' }, { createdAt: 'asc' }] },
    },
  })
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const settings = await getAudienceSettings()
  const best = bestEmail(p.emails, p, settings)
  const firstSource = p.firstContainerId ? await prisma.audienceVideo.findFirst({ where: { youtubeVideoId: p.firstContentId || '' }, select: { title: true, url: true, platform: true, youtubeVideoId: true, channel: { select: { title: true } } } }) : null
  return NextResponse.json({
    ...p, sendableEmailId: best?.id || null, readinessGap: p.lead ? null : readinessGap(p, settings), firstSource,
    // Composite confidence (0-100) is stored as the first reason
    emails: p.emails.map((e) => ({ ...e, composite: Number(e.confidenceReasons[0]) || null, reasons: e.confidenceReasons.slice(1) })),
    settings: { sendPolicy: settings.sendPolicy, strictRegions: settings.strictRegions },
  })
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
  // Use case, set by hand (never overwritten by rules or AI afterwards)
  useCase: z.string().nullish(),
  useCaseDetail: z.string().trim().max(140).nullish(),
  forWhom: z.enum(['SELF', 'CLIENTS', 'EMPLOYER', 'UNKNOWN']).nullish(),
  buildStage: z.enum(['EXPLORING', 'BUILDING', 'SHIPPED', 'SELLING']).nullish(),
  blocker: z.string().trim().max(120).nullish(),
  vertical: z.string().trim().max(60).nullish(),
  warmTouch: z.enum(['TODO', 'TOUCHED', 'RESPONDED', 'SKIPPED']).nullish(),
  inauthentic: z.boolean().optional(),
})
const USE_CASE_FIELDS = ['useCase', 'useCaseDetail', 'forWhom', 'buildStage', 'blocker', 'vertical']

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
      ...(USE_CASE_FIELDS.some((k) => d[k as keyof typeof d] !== undefined) ? { useCaseSource: 'MANUAL', whyTriven: null, outreachAngle: null } : {}),
      ...(d.warmTouch !== undefined ? { warmTouchedAt: d.warmTouch === 'TOUCHED' || d.warmTouch === 'RESPONDED' ? new Date() : undefined } : {}),
      ...(d.inauthentic !== undefined ? { inauthentic: d.inauthentic } : {}),
    },
  })
  await updateStatus(id)
  await recomputeIntelligence([id])
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
