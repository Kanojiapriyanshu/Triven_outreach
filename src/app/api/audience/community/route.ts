/**
 * POST /api/audience/community { community, rows: [{ name, profileUrl?, post, email?, website?, postedAt? }], consentToContact, permission }
 * Imports an export from a community you run or have written permission to use.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { importCommunity } from '@/lib/audience/community'

export const maxDuration = 60

const schema = z.object({
  community: z.string().trim().min(2).max(80),
  permission: z.literal(true, { errorMap: () => ({ message: 'Confirm you run this community or have written permission to use its data' }) }),
  consentToContact: z.boolean(),
  rows: z.array(z.object({
    name: z.string(), profileUrl: z.string().optional(), post: z.string(), email: z.string().optional(), website: z.string().optional(), postedAt: z.string().optional(),
  })).min(1).max(20_000),
})

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  try {
    return NextResponse.json(await importCommunity(parsed.data))
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
