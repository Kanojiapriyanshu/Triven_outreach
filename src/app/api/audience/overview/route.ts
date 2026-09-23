import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { audienceOverview } from '@/lib/audience/stats'

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await audienceOverview())
}
