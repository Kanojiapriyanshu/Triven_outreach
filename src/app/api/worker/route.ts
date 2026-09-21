/**
 * POST /api/worker
 * Background worker endpoint — called by GitHub Actions on a cron schedule.
 * Authenticated by the X-Worker-Secret header (never a user session).
 *
 * Body: { action: 'process_followups' | 'check_replies' }
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { sendFollowUpTask } from '@/lib/followups'

function isAuthorized(req: NextRequest) {
  const secret = req.headers.get('x-worker-secret')
  return secret && process.env.WORKER_SECRET && secret === process.env.WORKER_SECRET
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { action } = await req.json() as { action: string }

  // ── Process pending follow-ups ──────────────────────────────────────────────
  if (action === 'process_followups') {
    const now = new Date()

    // All PENDING tasks due now or in the past, oldest first
    const tasks = await prisma.followUpTask.findMany({
      where: { status: 'PENDING', scheduledAt: { lte: now } },
      select: { id: true },
      orderBy: { scheduledAt: 'asc' },
      take: 25, // stay well inside the 60s function limit
    })

    const results = { sent: 0, skipped: 0, failed: 0, errors: [] as string[] }

    for (const task of tasks) {
      const result = await sendFollowUpTask(task.id, { auto: true })
      if (result.outcome === 'sent') results.sent++
      else if (result.outcome === 'skipped') results.skipped++
      else {
        results.failed++
        results.errors.push(`Task ${task.id}: ${result.reason}`)
      }
    }

    return NextResponse.json({ ok: true, action, results, processedAt: now.toISOString() })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
