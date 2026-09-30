/**
 * POST /api/worker   (also GET, for cron services that can only call a URL)
 * Background worker, called every 5 minutes by an external scheduler (cron-job.org / QStash;
 * GitHub Actions is the backup — its "every 5 minutes" really runs a few times a day).
 * Authenticated by the X-Worker-Secret header, or ?secret= for URL-only schedulers.
 *
 * Action (body { action } or ?action=):
 *   auto     = the one URL a scheduler needs, called every minute: runs whichever job below is most
 *              overdue, after answering, so the scheduler gets an instant 200 and never times out
 *   tick     = check replies, then let every free inbox send; hourly health alerts
 *   audience = audience pipeline (refill sources → collect → review → research → verify → route)
 *   finder   = Lead Finder (continue business searches, research websites for emails)
 * Once a day one of the calls also runs the daily jobs (snapshots, segments, housekeeping).
 */
import { NextRequest, NextResponse, after } from 'next/server'
import prisma from '@/lib/prisma'
import { checkAllReplies } from '@/lib/replies'
import { runSequencer } from '@/lib/sequencer'
import { runAudiencePipeline } from '@/lib/audience/pipeline'
import { getAudienceSettings } from '@/lib/audience/settings'
import { runFinder } from '@/lib/finder/pipeline'
import { getFinderSettings } from '@/lib/finder/settings'
import { checkHealth } from '@/lib/health'
import { logRun } from '@/lib/worker-log'
import { runDailyJobs, dailyJobsDue } from '@/lib/daily'

export const maxDuration = 60

function isAuthorized(req: NextRequest) {
  const secret = req.headers.get('x-worker-secret') || new URL(req.url).searchParams.get('secret')
  return !!secret && !!process.env.WORKER_SECRET && secret === process.env.WORKER_SECRET
}

/** How often each job should run (minutes); "auto" picks the one furthest past its interval */
const EVERY: Record<string, number> = { tick: 2, audience: 10, finder: 10 }

async function mostOverdue() {
  const last = await prisma.workerRun.groupBy({ by: ['action'], where: { action: { in: Object.keys(EVERY) } }, _max: { startedAt: true } })
  const overdue = (a: string) => {
    const at = last.find((l) => l.action === a)?._max.startedAt
    return at ? (Date.now() - at.getTime()) / 60_000 / EVERY[a] : Infinity
  }
  return Object.keys(EVERY).sort((a, b) => overdue(b) - overdue(a))[0]
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = req.method === 'POST' ? await req.json().catch(() => ({})) as { action?: string } : {}
  const action = body.action || new URL(req.url).searchParams.get('action') || 'tick'
  const source = req.headers.get('x-worker-source') || req.headers.get('user-agent')?.slice(0, 60) || null
  const started = Date.now()
  const processedAt = new Date().toISOString()

  if (action === 'auto') {
    const next = await mostOverdue()
    after(() => run(next, source, started).catch(() => null))
    return NextResponse.json({ ok: true, action, running: next, processedAt })
  }

  try {
    const results = await run(action, source, started)
    return NextResponse.json({ ok: true, action, ...results, processedAt })
  } catch (err) {
    return NextResponse.json({ ok: false, action, error: (err as Error).message, processedAt }, { status: /Unknown action/.test((err as Error).message) ? 400 : 500 })
  }
}

function run(action: string, source: string | null, started: number) {
  return logRun(action, source, async (): Promise<Record<string, unknown>> => {
    switch (action) {
      case 'check_replies':
        return { replies: await checkAllReplies(started + 50_000) }
      case 'send':
      case 'process_followups':
        return { results: await runSequencer(started + 50_000) }
      case 'tick': {
        // Replies first so nobody who just answered gets another email
        const replies = await checkAllReplies(started + 18_000)
        const results = await runSequencer(started + 48_000)
        const health = Date.now() - started < 50_000 ? await checkHealth().catch((e) => ({ error: (e as Error).message })) : { skipped: 'no time' }
        return { replies, results, health }
      }
      case 'audience': {
        // Once a day this call runs the daily jobs instead (snapshots, quality pass, segment feeds)
        if (await dailyJobsDue()) return { daily: await runDailyJobs(started + 55_000) }
        if (!(await getAudienceSettings()).autoRun) return { skipped: 'auto-run is off' }
        return { pipeline: await runAudiencePipeline(started + 50_000) }
      }
      case 'finder': {
        if (!(await getFinderSettings()).autoResearch) return { skipped: 'auto-research is off' }
        return { finder: await runFinder(started + 50_000) }
      }
      case 'daily':
        return { daily: await runDailyJobs(started + 55_000) }
      default:
        throw new Error(`Unknown action: ${action}`)
    }
  })
}

export const POST = handle
export const GET = handle
