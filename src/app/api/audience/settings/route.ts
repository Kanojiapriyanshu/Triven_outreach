import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { getAudienceSettings, saveAudienceSettings } from '@/lib/audience/settings'
import { updateAllStatuses } from '@/lib/audience/pipeline'

export const maxDuration = 60

const schema = z.object({
  sendPolicy: z.enum(['VERIFIED_ONLY', 'VERIFIED_OR_PUBLISHED']),
  strictRegions: z.boolean(),
  countries: z.array(z.string().length(2)).max(80),
  enrichFrom: z.enum(['HIGH', 'MEDIUM']),
  maxCommentsPerVideo: z.number().int().min(100).max(20000),
  autoRun: z.boolean(),
  useAi: z.boolean(),
  retentionDays: z.number().int().min(7).max(365),
  businessEmailsOnly: z.boolean(),
  outreachFrom: z.enum(['HIGH', 'MEDIUM']),
  minIdentity: z.number().int().min(0).max(100),
  useWebSearch: z.boolean(),
  useFinders: z.boolean(),
})

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await getAudienceSettings())
}

export async function PUT(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  const before = await getAudienceSettings()
  await saveAudienceSettings(parsed.data)
  // Rules that decide "ready to contact" changed: re-evaluate everyone
  const rulesChanged = before.sendPolicy !== parsed.data.sendPolicy || before.strictRegions !== parsed.data.strictRegions ||
    before.countries.join() !== parsed.data.countries.join() || before.businessEmailsOnly !== parsed.data.businessEmailsOnly ||
    before.outreachFrom !== parsed.data.outreachFrom || before.minIdentity !== parsed.data.minIdentity
  const updated = rulesChanged ? await updateAllStatuses(Date.now() + 45_000) : 0
  return NextResponse.json({ ...parsed.data, reevaluated: updated })
}
