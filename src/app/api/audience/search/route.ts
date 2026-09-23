/**
 * POST /api/audience/search
 * YouTube video search (100 quota units). Results are saved as DISCOVERED videos with an
 * audience-fit score, so they can be queued for comment collection.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { searchVideos, YouTubeError } from '@/lib/audience/youtube'
import { saveVideos } from '@/lib/audience/actions'

export const maxDuration = 30

const schema = z.object({
  q: z.string().trim().min(2, 'Type what to search for'),
  regionCode: z.string().length(2).optional().or(z.literal('')),
  publishedWithinDays: z.number().int().min(0).max(3650).optional(),
  order: z.enum(['relevance', 'viewCount', 'date']).optional(),
  duration: z.enum(['any', 'medium', 'long']).optional(),
})

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  const { q, regionCode, publishedWithinDays, order, duration } = parsed.data
  try {
    const videos = await searchVideos({
      q,
      regionCode: regionCode || undefined,
      order,
      duration,
      publishedAfter: publishedWithinDays ? new Date(Date.now() - publishedWithinDays * 86_400_000).toISOString() : undefined,
    })
    const saved = await saveVideos(videos)
    saved.sort((a, b) => b.score - a.score)
    return NextResponse.json({ videos: saved })
  } catch (err) {
    const status = err instanceof YouTubeError && err.reason === 'quotaExceeded' ? 429 : 400
    return NextResponse.json({ error: (err as Error).message }, { status })
  }
}
