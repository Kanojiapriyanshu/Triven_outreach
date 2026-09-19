import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { columnMapping } = await req.json()
  // columnMapping: { csvColumn: dbField, ... }

  const importRecord = await prisma.import.findUnique({
    where: { id },
    include: { rows: { take: 2000 } },
  })
  if (!importRecord) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Save column mapping
  await prisma.import.update({ where: { id }, data: { columnMapping, status: 'VALIDATING' } })

  // Get sender accounts for lookup
  const senderAccounts = await prisma.senderAccount.findMany({
    select: { id: true, email: true, displayName: true },
  })
  const senderByEmail = new Map(senderAccounts.map((s) => [s.email.toLowerCase(), s]))

  let validRows = 0, duplicateRows = 0, errorRows = 0
  let missingEmail = 0, unknownSender = 0, invalidDates = 0

  const updates: Array<{ id: string; status: string; errorMsg?: string }> = []

  for (const row of importRecord.rows) {
    const data = row.rawData as Record<string, string>
    const mapped: Record<string, string> = {}

    for (const [csvCol, dbField] of Object.entries(columnMapping as Record<string, string>)) {
      if (dbField && data[csvCol] !== undefined) {
        mapped[dbField] = data[csvCol]
      }
    }

    const email = mapped['companyEmail']?.toLowerCase().trim()
    const senderEmail = mapped['senderAccount']?.toLowerCase().trim()

    let status = 'VALID'
    const errors: string[] = []

    if (!mapped['companyName']?.trim()) errors.push('Missing company name')
    if (!email) { missingEmail++; errors.push('Missing email') }

    if (email) {
      const dupe = await prisma.lead.findFirst({ where: { companyEmail: email } })
      if (dupe) { duplicateRows++; status = 'DUPLICATE'; errors.push('Duplicate email') }
    }

    if (senderEmail && !senderByEmail.has(senderEmail)) {
      unknownSender++; errors.push(`Unknown sender: ${senderEmail}`)
    }

    // Validate dates
    const dateFields = ['firstEmailSentAt', 'followUp1SentAt', 'followUp2SentAt', 'followUp3SentAt']
    for (const f of dateFields) {
      if (mapped[f] && isNaN(Date.parse(mapped[f]))) {
        invalidDates++; errors.push(`Invalid date in ${f}`)
      }
    }

    if (errors.length > 0 && status !== 'DUPLICATE') status = 'ERROR'
    if (status === 'ERROR') errorRows++
    else if (status === 'VALID') validRows++

    updates.push({ id: row.id, status, errorMsg: errors.join('; ') || undefined })
  }

  // Batch update rows
  for (const u of updates) {
    await prisma.importRow.update({ where: { id: u.id }, data: { status: u.status, errorMsg: u.errorMsg } })
  }

  await prisma.import.update({
    where: { id },
    data: { status: 'READY', validRows, duplicateRows, errorRows },
  })

  return NextResponse.json({
    importId: id,
    totalRows: importRecord.rows.length,
    validRows,
    duplicateRows,
    errorRows,
    missingEmail,
    unknownSender,
    invalidDates,
  })
}
