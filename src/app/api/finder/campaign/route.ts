/**
 * GET  /api/finder/campaign?niche=dental → the campaign that niche goes to, if any
 * POST /api/finder/campaign { niche, location? } → create it (DRAFT) with the niche's 4-step sequence
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { campaignForNiche, createNicheCampaign } from '@/lib/finder/pipeline'

export async function GET(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await campaignForNiche(new URL(req.url).searchParams.get('niche')))
}

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { niche, location } = await req.json().catch(() => ({})) as { niche?: string; location?: string }
  try {
    return NextResponse.json(await createNicheCampaign(niche || '', location), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
