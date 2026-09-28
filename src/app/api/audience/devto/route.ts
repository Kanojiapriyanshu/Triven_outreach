/**
 * POST /api/audience/devto  { tag, days?, minComments? }
 * DEV (dev.to) article search by tag (free, no key). Results are saved as sources ready to collect.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { searchArticles } from '@/lib/audience/devto'
import { saveDevArticles } from '@/lib/audience/actions'

export const maxDuration = 30

const schema = z.object({
  tag: z.string().trim().min(2, 'Type a tag, e.g. aiagents'),
  days: z.number().int().min(1).max(3650).optional(),
  minComments: z.number().int().min(0).max(1000).optional(),
})

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  try {
    const articles = await searchArticles(parsed.data.tag, parsed.data)
    const saved = await saveDevArticles(articles)
    saved.sort((a, b) => b.score - a.score)
    return NextResponse.json({ videos: saved })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
