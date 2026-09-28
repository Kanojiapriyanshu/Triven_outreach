/** GET /api/finder/overview → funnel counts, API usage, which services are connected, settings */
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { finderBacklog } from '@/lib/finder/pipeline'
import { getFinderSettings } from '@/lib/finder/settings'
import { googleConfigured, googleUsage } from '@/lib/finder/places'
import { searchProvider } from '@/lib/audience/identity'
import { verifierProvider } from '@/lib/audience/verify'
import { hunterAccount, hunterConfigured } from '@/lib/audience/hunter'

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [byStatus, byTier, callList, settings, usage, backlog, hunter] = await Promise.all([
    prisma.business.groupBy({ by: ['status'], _count: true }),
    prisma.business.groupBy({ by: ['tier'], where: { status: 'READY' }, _count: true }),
    prisma.business.count({ where: { status: { in: ['NO_EMAIL', 'EMAIL_FOUND'] }, phone: { not: null } } }),
    getFinderSettings(),
    googleUsage(),
    finderBacklog(),
    hunterConfigured() ? hunterAccount().catch(() => null) : Promise.resolve(null),
  ])
  const status: Record<string, number> = {}
  for (const r of byStatus) status[r.status] = r._count
  const tiers: Record<string, number> = {}
  for (const r of byTier) tiers[r.tier] = r._count
  return NextResponse.json({
    status, tiers, callList, backlog, settings,
    total: Object.values(status).reduce((a, b) => a + b, 0),
    google: { configured: googleConfigured(), used: usage, cap: settings.googleMonthlyCap },
    services: {
      google: googleConfigured(),
      search: searchProvider(),
      verifier: verifierProvider(),
      hunter: hunter ? { remaining: hunter.remaining, available: hunter.available } : hunterConfigured() ? { remaining: null, available: null } : null,
    },
  })
}
