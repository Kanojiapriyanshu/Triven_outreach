/** GET /api/insights → what converts (by use case, persona, stage, source, evidence) + A/B results */
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { insights } from '@/lib/insights'

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await insights())
}
