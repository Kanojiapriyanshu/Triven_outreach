import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { getFinderSettings, saveFinderSettings } from '@/lib/finder/settings'

const schema = z.object({
  googleMonthlyCap: z.number().int().min(0).max(100_000),
  sendPolicy: z.enum(['VERIFIED_ONLY', 'VERIFIED_OR_PUBLISHED']),
  excludeChains: z.boolean(),
  minReviews: z.number().int().min(0).max(10_000),
  minRating: z.number().min(0).max(5),
  autoResearch: z.boolean(),
  useWebSearch: z.boolean(),
  useHunter: z.boolean(),
  guessEmails: z.boolean(),
}).partial()

export async function PUT(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  const next = { ...(await getFinderSettings()), ...parsed.data }
  await saveFinderSettings(next)
  return NextResponse.json(next)
}
