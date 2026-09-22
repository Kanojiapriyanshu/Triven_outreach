import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { parseISO, isValid } from 'date-fns'
import { mapRow } from '@/lib/import-mapping'

const processSchema = z.object({
  duplicateAction: z.enum(['skip', 'update']).default('skip'),
  // Niche the leads go into (their templates are used automatically)
  campaignId: z.string().optional(),
  // A sender id, or "rotate" to spread leads across connected Gmail accounts
  senderAccountId: z.string().optional(),
  // Switch the campaign on once the leads are in
  launch: z.boolean().optional(),
})

function parseDate(v?: string) {
  if (!v) return undefined
  const d = parseISO(v)
  if (isValid(d)) return d
  const loose = new Date(v)
  return isValid(loose) ? loose : undefined
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const parsed = processSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid import options' }, { status: 400 })
  const { duplicateAction, campaignId, senderAccountId, launch } = parsed.data

  const importRecord = await prisma.import.findUnique({ where: { id } })
  if (!importRecord) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const columnMapping = (importRecord.columnMapping || {}) as Record<string, string>
  const rows = await prisma.importRow.findMany({
    where: { importId: id, status: { in: ['VALID', 'DUPLICATE'] } },
    orderBy: { rowNumber: 'asc' },
  })

  const campaign = campaignId ? await prisma.campaign.findUnique({ where: { id: campaignId } }) : null
  const allSenders = await prisma.senderAccount.findMany({ select: { id: true, email: true, gmailStatus: true } })
  const senderByEmail = new Map(allSenders.map((s) => [s.email.toLowerCase(), s.id]))
  const rotation = allSenders.filter((s) => s.gmailStatus === 'CONNECTED').map((s) => s.id)
  let turn = 0
  const pickSender = (fromSheet?: string) => {
    if (fromSheet && senderByEmail.has(fromSheet)) return senderByEmail.get(fromSheet)
    if (senderAccountId === 'rotate') return rotation.length ? rotation[turn++ % rotation.length] : undefined
    return senderAccountId || undefined
  }

  await prisma.import.update({ where: { id }, data: { status: 'IMPORTING' } })

  const toCreate: Prisma.LeadCreateManyInput[] = []
  const createdRowIds: string[] = []
  let updated = 0

  for (const row of rows) {
    if (row.status === 'DUPLICATE' && duplicateAction === 'skip') continue
    const { data, senderEmail } = mapRow(row.rawData as Record<string, unknown>, columnMapping)
    const firstSentAt = parseDate(data.firstEmailSentAt)

    const lead = {
      companyName: data.companyName || data.companyEmail?.split('@')[1] || 'Unknown',
      companyEmail: data.companyEmail,
      firstName: data.firstName,
      lastName: data.lastName,
      fullName: data.fullName,
      jobTitle: data.jobTitle,
      phone: data.phone,
      website: data.website,
      linkedIn: data.linkedIn,
      industry: data.industry || campaign?.industry || undefined,
      city: data.city,
      state: data.state,
      country: data.country,
      companySize: data.companySize,
      priority: data.priority || 'MEDIUM',
      status: firstSentAt ? 'FIRST_EMAIL_SENT' : data.status || 'NEW',
      notes: data.notes,
      personalizationNotes: data.personalizationNotes,
      whyThisLead: data.whyThisLead,
      companyPainPoint: data.companyPainPoint,
      socialMediaNotes: data.socialMediaNotes,
      firstEmailSentAt: firstSentAt,
      lastContactedAt: firstSentAt,
      campaignId: campaign?.id,
      senderAccountId: pickSender(senderEmail),
      leadSource: 'IMPORT',
      assignedUserId: session.userId,
    }

    if (row.status === 'DUPLICATE' && data.companyEmail) {
      const existing = await prisma.lead.findFirst({ where: { companyEmail: data.companyEmail } })
      if (existing) {
        // Fill gaps only — never overwrite outreach history or anything already set
        const patch = Object.fromEntries(
          Object.entries(lead).filter(([k, v]) => v !== undefined && (existing as Record<string, unknown>)[k] == null),
        )
        await prisma.lead.update({ where: { id: existing.id }, data: patch })
        await prisma.importRow.update({ where: { id: row.id }, data: { status: 'IMPORTED', leadId: existing.id } })
        updated++
        continue
      }
    }
    toCreate.push(lead)
    createdRowIds.push(row.id)
  }

  // Bulk insert in chunks
  for (let i = 0; i < toCreate.length; i += 500) {
    await prisma.lead.createMany({ data: toCreate.slice(i, i + 500) })
  }
  if (createdRowIds.length) {
    await prisma.importRow.updateMany({ where: { id: { in: createdRowIds } }, data: { status: 'IMPORTED' } })
  }

  const importedRows = toCreate.length + updated
  await prisma.import.update({ where: { id }, data: { status: 'COMPLETED', importedRows } })

  // Optionally launch the campaign (same checks as the Launch button)
  let launched = false
  let launchError: string | undefined
  if (launch && campaign && campaign.sendingStatus !== 'ACTIVE') {
    const template = await prisma.emailTemplate.findFirst({ where: { type: 'FIRST_EMAIL', OR: [{ campaignId: campaign.id }, { campaignId: null }] } })
    const connected = await prisma.senderAccount.count({ where: { gmailStatus: 'CONNECTED', isActive: true } })
    if (!template) launchError = 'Imported, but not launched: add a first-email template first.'
    else if (!connected) launchError = 'Imported, but not launched: no Gmail inbox is connected.'
    else {
      await prisma.campaign.update({ where: { id: campaign.id }, data: { sendingStatus: 'ACTIVE', launchedAt: campaign.launchedAt ?? new Date() } })
      launched = true
    }
  } else if (launch && campaign?.sendingStatus === 'ACTIVE') launched = true

  return NextResponse.json({ ok: true, importedRows, created: toCreate.length, updated, launched, launchError })
}
