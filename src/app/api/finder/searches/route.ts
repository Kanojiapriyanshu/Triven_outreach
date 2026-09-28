/**
 * GET  /api/finder/searches → recent searches
 * POST /api/finder/searches { niche?, query?, locations[], country?, provider?, maxPerPlace? }
 *      Saves the search and runs it for up to ~40 s; the worker / "Run" button finishes the rest.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { nicheOf } from '@/lib/finder/niches'
import { runSearch } from '@/lib/finder/pipeline'
import { googleConfigured } from '@/lib/finder/places'

export const maxDuration = 60

const schema = z.object({
  niche: z.string().optional(),
  query: z.string().trim().max(120).optional(),
  locations: z.array(z.string().trim().min(2).max(120)).min(1, 'Add at least one location').max(50, 'Up to 50 locations per search'),
  country: z.string().length(2).optional(),
  provider: z.enum(['GOOGLE', 'OSM']).optional(),
  maxPerPlace: z.number().int().min(20).max(60).optional(),
})

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const searches = await prisma.leadSearch.findMany({ orderBy: { createdAt: 'desc' }, take: 30 })
  const ids = searches.map((s) => s.id)
  const byStatus = ids.length ? await prisma.business.groupBy({ by: ['searchId', 'status'], where: { searchId: { in: ids } }, _count: true }) : []
  return NextResponse.json(searches.map((s) => {
    const counts: Record<string, number> = {}
    for (const r of byStatus.filter((x) => x.searchId === s.id)) counts[r.status] = r._count
    return { ...s, counts }
  }))
}

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  const d = parsed.data
  const niche = nicheOf(d.niche)
  const query = d.query || niche?.query
  if (!query) return NextResponse.json({ error: 'Pick a niche or type what to search for' }, { status: 400 })
  const provider = d.provider || (googleConfigured() ? 'GOOGLE' : 'OSM')
  if (provider === 'GOOGLE' && !googleConfigured()) return NextResponse.json({ error: 'Add GOOGLE_PLACES_API_KEY to search Google, or use OpenStreetMap (free, no key)' }, { status: 400 })
  if (provider === 'OSM' && !niche) return NextResponse.json({ error: 'OpenStreetMap search needs a niche from the list' }, { status: 400 })

  const locations = [...new Set(d.locations)]
  const search = await prisma.leadSearch.create({
    data: { query, niche: niche?.id || null, locations, country: d.country?.toUpperCase() || null, provider, maxPerPlace: d.maxPerPlace || 60 },
  })
  const result = await runSearch(search.id, Date.now() + 40_000)
  return NextResponse.json(result, { status: 201 })
}
