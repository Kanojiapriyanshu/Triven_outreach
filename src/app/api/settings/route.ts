import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { getSettings, saveSettings } from '@/lib/settings'

const hhmm = z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/, 'Use HH:mm, e.g. 21:00')

const settingsSchema = z.object({
  sendWindow: z.object({
    timezone: z.string().refine((tz) => {
      try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true } catch { return false }
    }, 'Unknown timezone'),
    start: hhmm,
    end: hhmm,
    skipWeekends: z.boolean(),
  }).refine((w) => w.start < w.end, { message: 'Window end must be after start' }),
  followUpDays: z.tuple([z.number().int().min(1), z.number().int().min(1), z.number().int().min(1)]),
  dailyCapPerSender: z.number().int().min(1).max(500),
  minGapMinutes: z.number().int().min(1).max(240),
  maxGapMinutes: z.number().int().min(1).max(240),
  demoPhone: z.string().trim().max(40).regex(/^[+\d\s().-]*$/, 'Phone number can only contain digits, spaces, + ( ) -').default(''),
  builderUrl: z.string().trim().max(200).refine((u) => !u || /^https:\/\/[^\s]+$/.test(u), 'Use a full https:// link').default(''),
  senderAddress: z.string().trim().max(200).default(''),
}).refine((s) => s.minGapMinutes <= s.maxGapMinutes, { message: 'Minimum gap must be less than the maximum' })

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await getSettings())
}

export async function PUT(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = settingsSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  await saveSettings(parsed.data)
  return NextResponse.json(parsed.data)
}
