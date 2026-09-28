/** GET /api/command → the dashboard's "next moves", 30-day funnel and 14-day activity */
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { nextMoves, funnel30, activity14 } from '@/lib/command'

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [moves, funnel, activity] = await Promise.all([nextMoves(), funnel30(), activity14()])
  return NextResponse.json({ moves, funnel, activity })
}
