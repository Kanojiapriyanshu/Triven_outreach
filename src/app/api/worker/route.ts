/**
 * POST /api/worker
 * Background worker endpoint, called by GitHub Actions (or any cron) every ~5 minutes.
 * Authenticated by the X-Worker-Secret header (never a user session).
 *
 * Body: { action: 'tick' | 'send' | 'check_replies' | 'audience' }
 *   tick     = check replies, then let every free inbox send one email
 *   audience = YouTube audience pipeline (collect → AI review → enrich → verify)
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkAllReplies } from '@/lib/replies'
import { runSequencer } from '@/lib/sequencer'
import { runAudiencePipeline } from '@/lib/audience/pipeline'
import { getAudienceSettings } from '@/lib/audience/settings'

export const maxDuration = 60

function isAuthorized(req: NextRequest) {
  const secret = req.headers.get('x-worker-secret')
  return secret && process.env.WORKER_SECRET && secret === process.env.WORKER_SECRET
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { action } = await req.json().catch(() => ({ action: 'tick' })) as { action: string }
  const started = Date.now()
  const processedAt = new Date().toISOString()

  if (action === 'check_replies') {
    const replies = await checkAllReplies(started + 50_000)
    return NextResponse.json({ ok: true, action, replies, processedAt })
  }

  if (action === 'send' || action === 'process_followups') {
    const results = await runSequencer(started + 50_000)
    return NextResponse.json({ ok: true, action, results, processedAt })
  }

  if (action === 'tick') {
    // Replies first so nobody who just answered gets another email
    const replies = await checkAllReplies(started + 20_000)
    const results = await runSequencer(started + 52_000)
    return NextResponse.json({ ok: true, action, replies, results, processedAt })
  }

  if (action === 'audience') {
    if (!(await getAudienceSettings()).autoRun) return NextResponse.json({ ok: true, action, skipped: 'auto-run is off', processedAt })
    const results = await runAudiencePipeline(started + 50_000)
    return NextResponse.json({ ok: true, action, results, processedAt })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
