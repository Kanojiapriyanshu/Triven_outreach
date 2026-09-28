/** GET/PUT /api/settings/spend → daily caps per paid service and today's usage (admin only for PUT) */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { getCaps, saveCaps, usageToday } from '@/lib/budget'

const schema = z.object({ ai: z.number().int().min(0).max(100_000), search: z.number().int().min(0).max(100_000), verifier: z.number().int().min(0).max(100_000), finder: z.number().int().min(0).max(100_000) })

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [caps, used] = await Promise.all([getCaps(), usageToday()])
  return NextResponse.json({ caps, used })
}

export async function PUT(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  await saveCaps(parsed.data)
  return NextResponse.json(parsed.data)
}
