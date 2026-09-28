/**
 * GET  /api/system → worker heartbeat, campaign capacity + idle reasons, setup checklist, queues, errors
 * POST /api/system { action: 'tick' | 'audience' | 'finder' | 'daily' } → run one worker step now (logged as "manual")
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { workerStats, logRun } from '@/lib/worker-log'
import { campaignCapacity } from '@/lib/capacity'
import { setupChecklist } from '@/lib/setup'
import { pipelineBacklog, runAudiencePipeline } from '@/lib/audience/pipeline'
import { finderBacklog, runFinder } from '@/lib/finder/pipeline'
import { checkAllReplies } from '@/lib/replies'
import { runSequencer } from '@/lib/sequencer'
import { runDailyJobs } from '@/lib/daily'

export const maxDuration = 60

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const now = new Date()
  const [worker, capacity, setup, audience, finder, followUpsDue, followUpsOverdue, errors] = await Promise.all([
    workerStats(),
    campaignCapacity(),
    setupChecklist(),
    pipelineBacklog(),
    finderBacklog(),
    prisma.followUpTask.count({ where: { status: 'PENDING', scheduledAt: { lte: now } } }),
    prisma.followUpTask.count({ where: { status: 'PENDING', scheduledAt: { lt: new Date(now.getTime() - 86_400_000) } } }),
    prisma.workerRun.findMany({ where: { ok: false }, orderBy: { startedAt: 'desc' }, take: 8, select: { action: true, startedAt: true, error: true } }),
  ])
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
  return NextResponse.json({
    worker, capacity, setup, errors: errors.map((e) => ({ ...e, error: e.error?.split('\n')[0] })),
    queues: { audience, finder, followUpsDue, followUpsOverdue },
    scheduler: { url: `${appUrl}/api/worker`, header: 'X-Worker-Secret', secretSet: !!process.env.WORKER_SECRET },
  })
}

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { action } = await req.json().catch(() => ({})) as { action?: string }
  const started = Date.now()
  try {
    const result = await logRun(action || 'tick', `manual:${session.email}`, async () => {
      if (action === 'audience') return runAudiencePipeline(started + 50_000)
      if (action === 'finder') return runFinder(started + 50_000)
      if (action === 'daily') return runDailyJobs(started + 50_000)
      const replies = await checkAllReplies(started + 18_000)
      return { replies, results: await runSequencer(started + 50_000) }
    })
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
