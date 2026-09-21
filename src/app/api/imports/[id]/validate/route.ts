import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { mapRow, duplicateTargets } from '@/lib/import-mapping'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { columnMapping } = await req.json() as { columnMapping: Record<string, string> }

  const dupes = duplicateTargets(columnMapping || {})
  if (dupes.length) {
    return NextResponse.json({ error: `More than one column is mapped to: ${dupes.join(', ')}. Pick one.` }, { status: 400 })
  }
  if (!Object.values(columnMapping).some((f) => f === 'companyEmail' || f === 'companyName')) {
    return NextResponse.json({ error: 'Map at least an Email or a Company column' }, { status: 400 })
  }

  const importRecord = await prisma.import.findUnique({ where: { id } })
  if (!importRecord) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const rows = await prisma.importRow.findMany({ where: { importId: id }, orderBy: { rowNumber: 'asc' }, take: 10000 })

  await prisma.import.update({ where: { id }, data: { columnMapping, status: 'VALIDATING' } })

  const mapped = rows.map((r) => ({ row: r, m: mapRow(r.rawData as Record<string, unknown>, columnMapping) }))

  // One query for all duplicates against existing leads
  const emails = [...new Set(mapped.map((x) => x.m.data.companyEmail).filter(Boolean) as string[])]
  const existing = new Set(
    (await prisma.lead.findMany({ where: { companyEmail: { in: emails } }, select: { companyEmail: true } }))
      .map((l) => l.companyEmail!),
  )
  const senders = new Set((await prisma.senderAccount.findMany({ select: { email: true } })).map((s) => s.email.toLowerCase()))

  const seenInFile = new Set<string>()
  const groups = new Map<string, string[]>() // "STATUS|message" → row ids
  const stats = { validRows: 0, duplicateRows: 0, errorRows: 0, missingEmail: 0, unknownSender: 0, inFileDuplicates: 0 }
  const sampleErrors: Array<{ row: number; message: string }> = []

  for (const { row, m } of mapped) {
    const email = m.data.companyEmail
    let status = 'VALID'
    const notes = [...m.warnings]

    if (m.errors.length) {
      status = 'ERROR'
      notes.unshift(...m.errors)
    } else if (email && existing.has(email)) {
      status = 'DUPLICATE'
      notes.unshift('Already in CRM')
    } else if (email && seenInFile.has(email)) {
      status = 'ERROR'
      notes.unshift('Same email appears earlier in this file')
      stats.inFileDuplicates++
    }
    if (email) seenInFile.add(email)
    if (!email) stats.missingEmail++
    if (m.senderEmail && !senders.has(m.senderEmail)) {
      stats.unknownSender++
      notes.push(`Unknown sender ${m.senderEmail} (will use the one you pick)`)
    }

    if (status === 'VALID') stats.validRows++
    else if (status === 'DUPLICATE') stats.duplicateRows++
    else {
      stats.errorRows++
      if (sampleErrors.length < 5) sampleErrors.push({ row: row.rowNumber, message: notes[0] })
    }

    const key = `${status}|${notes.join('; ')}`
    groups.set(key, [...(groups.get(key) || []), row.id])
  }

  for (const [key, ids] of groups) {
    const sep = key.indexOf('|')
    const status = key.slice(0, sep)
    const msg = key.slice(sep + 1)
    await prisma.importRow.updateMany({ where: { id: { in: ids } }, data: { status, errorMsg: msg || null } })
  }

  await prisma.import.update({
    where: { id },
    data: { status: 'READY', validRows: stats.validRows, duplicateRows: stats.duplicateRows, errorRows: stats.errorRows },
  })

  return NextResponse.json({ importId: id, totalRows: rows.length, ...stats, sampleErrors })
}
