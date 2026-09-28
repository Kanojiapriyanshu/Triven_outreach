/**
 * GET /api/campaigns/:id/samples → up to 20 first emails rendered exactly as they would be sent:
 * from the campaign's queued leads, or (for an empty campaign) from ready people who would be
 * routed to it. The launch check (PRD R6.4) shows these before the campaign can go live.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { getCapabilities } from '@/lib/audience/capabilities'
import { buildTemplateVars, renderTemplate, pickDefaultTemplate, checkLeadData, type TemplateLead } from '@/lib/template'
import { useCaseRoutes, routeFor } from '@/lib/audience/routing'
import { routeCampaigns } from '@/lib/audience/actions'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const campaign = await prisma.campaign.findUnique({ where: { id }, include: { senderAccounts: { include: { senderAccount: true } } } })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [templates, settings, caps] = await Promise.all([
    prisma.emailTemplate.findMany({ where: { type: 'FIRST_EMAIL', OR: [{ campaignId: id }, { campaignId: null }] } }),
    getSettings(),
    getCapabilities(),
  ])
  const a = pickDefaultTemplate(templates.filter((t) => t.variant !== 'B'), 'FIRST_EMAIL', id)
  const b = campaign.abTest ? templates.find((t) => t.campaignId === id && t.variant === 'B') : undefined
  if (!a) return NextResponse.json({ error: 'No first-email template for this campaign' }, { status: 400 })

  // Real people: queued leads first, otherwise ready prospects that would land here
  let leads: Array<TemplateLead & { id: string; companyEmail: string | null; source: string }> = (await prisma.lead.findMany({
    where: { campaignId: id, firstEmailSentAt: null, companyEmail: { not: null } },
    orderBy: [{ priority: 'asc' }, { score: 'desc' }], take: 20,
  })).map((l) => ({ ...l, source: 'Queued lead' }))
  if (!leads.length && campaign.useCase) {
    const [ucRoutes, persona] = await Promise.all([useCaseRoutes(), routeCampaigns()])
    const ready = await prisma.prospect.findMany({
      where: { status: { in: ['READY_TO_CONTACT', 'EMAIL_VERIFIED', 'EMAIL_FOUND'] }, inauthentic: false, lead: null },
      orderBy: { opportunityScore: 'desc' }, take: 300,
      include: { emails: true, comments: { orderBy: { score: 'desc' }, take: 1, include: { video: { include: { channel: { select: { title: true } } } } } } },
    })
    leads = ready.filter((p) => routeFor(p, ucRoutes, persona) === id).slice(0, 20).map((p) => ({
      id: p.id, firstName: p.firstName, lastName: p.lastName, fullName: p.firstName ? [p.firstName, p.lastName].filter(Boolean).join(' ') : p.displayName,
      companyName: p.company || '', companyEmail: p.emails.find((e) => e.isPrimary)?.email || p.emails.find((e) => e.status !== 'INVALID')?.email || null,
      industry: 'AI Builder', personalizationNotes: p.icebreaker, sourcePlatform: p.platform,
      sourceChannel: p.comments[0]?.video.channel.title, sourceVideo: p.comments[0]?.video.title,
      commentTopic: p.useCaseSource === 'AI' && p.useCaseDetail ? p.useCaseDetail.toLowerCase() : p.topic,
      interestCategory: p.interestCategory, persona: p.persona, useCase: p.useCase, companyPainPoint: p.useCaseSource !== 'RULES' ? p.blocker : null,
      source: `Would be routed here (${p.status === 'READY_TO_CONTACT' ? 'ready' : 'not ready yet'})`,
    }))
  }

  const sender = campaign.senderAccounts[0]?.senderAccount || await prisma.senderAccount.findFirst({ where: { gmailStatus: 'CONNECTED', isActive: true } })
  const extras = { demoPhone: settings.demoPhone, builderUrl: settings.builderUrl, senderAddress: settings.senderAddress, templateLinks: caps.templateLinks as Record<string, string> }
  const samples = leads.map((lead, i) => {
    const t = b && i % 2 === 1 ? b : a
    const vars = buildTemplateVars(lead, sender, extras)
    return {
      id: lead.id, to: lead.companyEmail, name: lead.fullName || lead.companyName, source: lead.source, variant: t === b ? 'B' : 'A',
      subject: renderTemplate(t.subject, vars), body: renderTemplate(t.body, vars), check: checkLeadData(lead, vars),
    }
  })
  const lastEdit = await prisma.emailTemplate.findFirst({ where: { campaignId: id }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } })
  return NextResponse.json({
    samples,
    checkedAt: campaign.launchCheckedAt,
    needsReview: !campaign.launchCheckedAt || (!!lastEdit && lastEdit.updatedAt > campaign.launchCheckedAt),
    missingAddress: !settings.senderAddress?.trim(),
  })
}
