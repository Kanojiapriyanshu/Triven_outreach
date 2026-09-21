import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const imports = await prisma.import.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return NextResponse.json(imports)
}

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const fileType = file.name.endsWith('.xlsx') || file.name.endsWith('.xls') ? 'XLSX' : 'CSV'
    const buffer = Buffer.from(await file.arrayBuffer())

    let rows: Record<string, string>[] = []
    let columns: string[] = []

    if (fileType === 'CSV') {
      const Papa = (await import('papaparse')).default
      const text = buffer.toString('utf-8').replace(/^﻿/, '') // strip Excel's BOM
      const result = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: (h) => h.trim(),
      })
      rows = result.data
      columns = result.meta.fields || []
    } else {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      // ExcelJS expects a Buffer – cast via ArrayBuffer for TS compatibility
      const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      await wb.xlsx.load(ab as ArrayBuffer)
      const ws = wb.worksheets[0]
      if (!ws) return NextResponse.json({ error: 'No worksheet found' }, { status: 400 })

      const headerRow = ws.getRow(1)
      columns = []
      headerRow.eachCell((cell) => { columns.push(String(cell.value || '').trim()) })

      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return
        const obj: Record<string, string> = {}
        row.eachCell((cell, colNum) => {
          const col = columns[colNum - 1]
          // cell.text is the displayed value (handles hyperlinks, rich text, formulas and dates)
          if (col) obj[col] = cell.value instanceof Date ? cell.value.toISOString() : (cell.text ?? '').trim()
        })
        rows.push(obj)
      })
    }

    // Create import record
    const importRecord = await prisma.import.create({
      data: {
        fileName: file.name,
        fileType,
        totalRows: rows.length,
        status: 'PENDING',
      },
    })

    // Save rows (batch)
    const BATCH = 200
    for (let i = 0; i < rows.length; i += BATCH) {
      await prisma.importRow.createMany({
        data: rows.slice(i, i + BATCH).map((rawData, idx) => ({
          importId: importRecord.id,
          rowNumber: i + idx + 1,
          rawData,
        })),
      })
    }

    return NextResponse.json({
      importId: importRecord.id,
      fileName: file.name,
      totalRows: rows.length,
      columns,
      sampleRows: rows.slice(0, 5),
      status: 'PENDING',
    })
  } catch (err) {
    console.error('[imports/POST]', err)
    return NextResponse.json({ error: 'Failed to process file' }, { status: 500 })
  }
}
