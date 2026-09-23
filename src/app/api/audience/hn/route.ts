/**
 * POST /api/audience/hn  { q, minComments?, sinceDays?, sort? }
 * Hacker News thread search (free, no key). Results are saved as sources ready to collect.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { searchStories } from '@/lib/audience/hn'
import { saveHnStories } from '@/lib/audience/actions'

export const maxDuration = 30

const schema = z.object({
  q: z.string().trim().min(2, 'Type what to search for'),
  minComments: z.number().int().min(0).max(5000).optional(),
  sinceDays: z.number().int().min(0).max(3650).optional(),
  sort: z.enum(['relevance', 'date']).optional(),
})

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  try {
    const stories = await searchStories(parsed.data.q, parsed.data)
    const saved = await saveHnStories(stories)
    saved.sort((a, b) => b.score - a.score)
    return NextResponse.json({ videos: saved })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
