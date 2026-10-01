/**
 * GET  /api/finder/searches → recent searches
 * POST /api/finder/searches { niche?, query?, locations[], country?, provider?, maxPerPlace? }
 *      provider: AUTO (every source that applies, merged) | GOOGLE | FOURSQUARE | TOMTOM | NPI | OSM
 *      Saves the search and runs it for up to ~40 s; the worker / "Run" button finishes the rest.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { nicheOf } from '@/lib/finder/niches'
import { runSearch } from '@/lib/finder/pipeline'
import { sourceProblem, sourcesFor, type SourceId } from '@/lib/finder/sources'

export const maxDuration = 60

const schema = z.object({
  niche: z.string().optional(),
  query: z.string().trim().max(120).optional(),
  locations: z.array(z.string().trim().min(2).max(120)).min(1, 'Add at least one location').max(50, 'Up to 50 locations per search'),
  country: z.string().length(2).optional(),
  provider: z.enum(['AUTO', 'GOOGLE', 'FOURSQUARE', 'TOMTOM', 'NPI', 'OSM']).optional(),
  maxPerPlace: z.number().int().min(20).max(200).optional(),
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
  const provider = d.provider || 'AUTO'
  const country = d.country?.toUpperCase() || null
  if (provider === 'AUTO') {
    if (!(await sourcesFor(niche, country)).length) return NextResponse.json({ error: 'No business source can run this search right now. Pick a niche from the list (OpenStreetMap is free), or add a Google, Foursquare or TomTom key.' }, { status: 400 })
  } else {
    const problem = sourceProblem(provider as SourceId, niche, country)
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })
  }

  const locations = [...new Set(d.locations)]
  const search = await prisma.leadSearch.create({
    data: { query, niche: niche?.id || null, locations, country, provider, maxPerPlace: d.maxPerPlace || 60 },
  })
  const result = await runSearch(search.id, Date.now() + 40_000)
  return NextResponse.json(result, { status: 201 })
}
