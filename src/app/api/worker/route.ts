/**
 * POST /api/worker
 * Background worker endpoint, called by GitHub Actions (or any cron) every ~15 minutes.
 * Authenticated by the X-Worker-Secret header (never a user session).
 *
 * Body: { action: 'tick' | 'process_followups' | 'check_replies' }
 *   tick = check replies, then send everything that is due
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { sendTask, SCHEDULED_EMAIL_TYPES } from '@/lib/followups'
import { checkAllReplies } from '@/lib/replies'
import { sentInLast24h } from '@/lib/outreach'
import { getSettings } from '@/lib/settings'
import { isInSendWindow } from '@/lib/send-window'

export const maxDuration = 60

function isAuthorized(req: NextRequest) {
  const secret = req.headers.get('x-worker-secret')
  return secret && process.env.WORKER_SECRET && secret === process.env.WORKER_SECRET
}

async function processQueue(deadline: number) {
  const now = new Date()
  const settings = await getSettings()
  const inWindow = isInSendWindow(now, settings.sendWindow)
  const results = { inWindow, sent: 0, skipped: 0, deferred: 0, failed: 0, capped: 0, errors: [] as string[] }

  // Scheduled emails go at the time the user picked; follow-ups only inside the send window
  const tasks = await prisma.followUpTask.findMany({
    where: {
      status: 'PENDING',
      scheduledAt: { lte: now },
      ...(inWindow ? {} : { type: { in: SCHEDULED_EMAIL_TYPES } }),
    },
    select: { id: true, type: true, senderAccount: { select: { email: true } }, lead: { select: { senderAccount: { select: { email: true } } } } },
    orderBy: { scheduledAt: 'asc' },
    take: 40,
  })

  // First emails before follow-ups
  tasks.sort((a, b) => Number(!SCHEDULED_EMAIL_TYPES.includes(a.type)) - Number(!SCHEDULED_EMAIL_TYPES.includes(b.type)))

  const sentCount = new Map<string, number>()
  for (const task of tasks) {
    if (Date.now() > deadline) break

    // Daily cap per Gmail account protects deliverability
    const senderEmail = task.senderAccount?.email || task.lead.senderAccount?.email
    if (senderEmail) {
      if (!sentCount.has(senderEmail)) sentCount.set(senderEmail, await sentInLast24h(senderEmail))
      if (sentCount.get(senderEmail)! >= settings.dailyCapPerSender) { results.capped++; continue }
    }

    const result = await sendTask(task.id, { auto: true })
    if (result.outcome === 'sent') {
      results.sent++
      if (senderEmail) sentCount.set(senderEmail, sentCount.get(senderEmail)! + 1)
    } else if (result.outcome === 'skipped') results.skipped++
    else if (result.outcome === 'deferred') results.deferred++
    else {
      results.failed++
      results.errors.push(`Task ${task.id}: ${result.reason}`)
    }
  }
  return results
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

  if (action === 'process_followups') {
    const results = await processQueue(started + 50_000)
    return NextResponse.json({ ok: true, action, results, processedAt })
  }

  if (action === 'tick') {
    // Replies first so nobody who just answered gets another follow-up
    const replies = await checkAllReplies(started + 25_000)
    const results = await processQueue(started + 52_000)
    return NextResponse.json({ ok: true, action, replies, results, processedAt })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
