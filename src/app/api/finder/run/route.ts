/**
 * POST /api/finder/run → ~48 s of searching + research, then what's left, so the page can call
 * again until the backlog is empty. The 5-minute worker does the same in the background.
 */
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { runFinder, finderBacklog } from '@/lib/finder/pipeline'

export const maxDuration = 60

export async function POST() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await runFinder(Date.now() + 48_000)
  return NextResponse.json({ ok: true, result, backlog: await finderBacklog() })
}
