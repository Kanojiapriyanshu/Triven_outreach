import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { checkAllReplies } from '@/lib/replies'

export const maxDuration = 60

const KEY = 'lastInboxSync'
const MIN_GAP_MS = 45_000 // don't hammer Gmail if several tabs ask at once

// GET: when did the last sync run?
export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const row = await prisma.setting.findUnique({ where: { key: KEY } })
  return NextResponse.json({ lastSyncAt: row?.value ?? null })
}

// POST: pull new replies from every connected Gmail right now (no emails are sent)
export async function POST() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const row = await prisma.setting.findUnique({ where: { key: KEY } })
  if (row && Date.now() - new Date(row.value).getTime() < MIN_GAP_MS) {
    return NextResponse.json({ skipped: true, lastSyncAt: row.value })
  }
  const result = await checkAllReplies(Date.now() + 40_000)
  return NextResponse.json({ ...result, lastSyncAt: new Date().toISOString() })
}
