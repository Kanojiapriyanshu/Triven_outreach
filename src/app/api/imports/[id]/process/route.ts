import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { addDays, parseISO, isValid } from 'date-fns'

function parseDate(v?: string): Date | undefined {
  if (!v) return undefined
  const d = parseISO(v)
  return isValid(d) ? d : undefined
}

function inferStatus(mapped: Record<string, string>): string {
  if (mapped['followUp3SentAt']) return 'FOLLOW_UP_3_SENT'
  if (mapped['followUp2SentAt']) return 'FOLLOW_UP_2_SENT'
  if (mapped['followUp1SentAt']) return 'FOLLOW_UP_1_SENT'
  if (mapped['firstEmailSentAt']) return 'FIRST_EMAIL_SENT'
  return mapped['status'] || 'NEW'
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { duplicateAction = 'skip' } = await req.json() // skip | update | create

  const importRecord = await prisma.import.findUnique({
    where: { id },
    include: { rows: { where: { status: { in: ['VALID', 'DUPLICATE'] } } } },
  })
  if (!importRecord) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const columnMapping = importRecord.columnMapping as Record<string, string>
  const senderAccounts = await prisma.senderAccount.findMany({
    select: { id: true, email: true },
  })
  const senderByEmail = new Map(senderAccounts.map((s) => [s.email.toLowerCase(), s]))

  await prisma.import.update({ where: { id }, data: { status: 'IMPORTING' } })

  let importedRows = 0

  for (const row of importRecord.rows) {
    if (row.status === 'DUPLICATE' && duplicateAction === 'skip') continue

    const data = row.rawData as Record<string, string>
    const mapped: Record<string, string> = {}
    for (const [csvCol, dbField] of Object.entries(columnMapping)) {
      if (dbField && data[csvCol] !== undefined) mapped[dbField] = data[csvCol]
    }

    const email = mapped['companyEmail']?.toLowerCase().trim() || undefined
    const senderEmail = mapped['senderAccount']?.toLowerCase().trim()
    const senderAccount = senderEmail ? senderByEmail.get(senderEmail) : undefined

    const inferredStatus = inferStatus(mapped)
    const fu3SentAt = parseDate(mapped['followUp3SentAt'])
    const fu2SentAt = parseDate(mapped['followUp2SentAt'])
    const fu1SentAt = parseDate(mapped['followUp1SentAt'])
    const firstSentAt = parseDate(mapped['firstEmailSentAt'])

    // Compute next follow-up
    let nextFollowUpAt: Date | undefined
    if (inferredStatus === 'FIRST_EMAIL_SENT' && firstSentAt) nextFollowUpAt = addDays(firstSentAt, 1)
    else if (inferredStatus === 'FOLLOW_UP_1_SENT' && fu1SentAt) nextFollowUpAt = addDays(fu1SentAt, 1)
    else if (inferredStatus === 'FOLLOW_UP_2_SENT' && fu2SentAt) nextFollowUpAt = addDays(fu2SentAt, 1)

    const leadData = {
      companyName: mapped['companyName'] || data['Company'] || 'Unknown',
      fullName: mapped['fullName'] || undefined,
      firstName: mapped['firstName'] || undefined,
      lastName: mapped['lastName'] || undefined,
      jobTitle: mapped['jobTitle'] || undefined,
      companyEmail: email,
      website: mapped['website'] || undefined,
      phone: mapped['phone'] || undefined,
      linkedIn: mapped['linkedIn'] || undefined,
      country: mapped['country'] || undefined,
      state: mapped['state'] || undefined,
      city: mapped['city'] || undefined,
      industry: mapped['industry'] || undefined,
      companySize: mapped['companySize'] || undefined,
      notes: mapped['notes'] || undefined,
      status: inferredStatus,
      priority: mapped['priority'] || 'MEDIUM',
      leadSource: 'IMPORT' as const,
      senderAccountId: senderAccount?.id || undefined,
      firstEmailSubject: mapped['firstEmailSubject'] || undefined,
      firstEmailBody: mapped['firstEmailBody'] || undefined,
      firstEmailSentAt: firstSentAt,
      followUp1SentAt: fu1SentAt,
      followUp2SentAt: fu2SentAt,
      followUp3SentAt: fu3SentAt,
      lastContactedAt: fu3SentAt || fu2SentAt || fu1SentAt || firstSentAt,
      nextFollowUpAt,
      personalizationNotes: mapped['personalizationNotes'] || undefined,
    }

    try {
      if (row.status === 'DUPLICATE' && duplicateAction === 'update' && email) {
        const existing = await prisma.lead.findFirst({ where: { companyEmail: email } })
        if (existing) {
          // Never overwrite existing outreach history
          await prisma.lead.update({
            where: { id: existing.id },
            data: {
              ...leadData,
              firstEmailSentAt: existing.firstEmailSentAt || leadData.firstEmailSentAt,
              followUp1SentAt: existing.followUp1SentAt || leadData.followUp1SentAt,
              followUp2SentAt: existing.followUp2SentAt || leadData.followUp2SentAt,
              followUp3SentAt: existing.followUp3SentAt || leadData.followUp3SentAt,
            },
          })
          await prisma.importRow.update({ where: { id: row.id }, data: { status: 'IMPORTED', leadId: existing.id } })
          importedRows++
          continue
        }
      }

      const lead = await prisma.lead.create({ data: leadData })
      await prisma.importRow.update({ where: { id: row.id }, data: { status: 'IMPORTED', leadId: lead.id } })
      importedRows++
    } catch (err) {
      console.error('[import/process row]', err)
      await prisma.importRow.update({ where: { id: row.id }, data: { status: 'ERROR', errorMsg: 'Insert failed' } })
    }
  }

  await prisma.import.update({
    where: { id },
    data: { status: 'COMPLETED', importedRows },
  })

  return NextResponse.json({ ok: true, importedRows })
}
