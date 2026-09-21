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
import { dailyAllowance } from '@/lib/outreach'
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
    select: {
      id: true,
      type: true,
      senderAccount: { select: { email: true, dailyEmailTarget: true } },
      lead: { select: { senderAccount: { select: { email: true, dailyEmailTarget: true } } } },
    },
    orderBy: { scheduledAt: 'asc' },
    take: 40,
  })

  // First emails before follow-ups
  tasks.sort((a, b) => Number(!SCHEDULED_EMAIL_TYPES.includes(a.type)) - Number(!SCHEDULED_EMAIL_TYPES.includes(b.type)))

  // Deliverability: each account gets its warm-up allowance for the day, and at most
  // PER_TICK sends per 15-minute run, so mail trickles out like a person sending it.
  const PER_TICK = 2
  const left = new Map<string, number>()
  const thisTick = new Map<string, number>()
  for (const task of tasks) {
    if (Date.now() > deadline) break

    const sender = task.senderAccount || task.lead.senderAccount
    if (sender) {
      if (!left.has(sender.email)) left.set(sender.email, (await dailyAllowance(sender, settings.dailyCapPerSender)).left)
      if (left.get(sender.email)! <= 0 || (thisTick.get(sender.email) || 0) >= PER_TICK) { results.capped++; continue }
    }

    const result = await sendTask(task.id, { auto: true })
    if (result.outcome === 'sent') {
      results.sent++
      if (sender) {
        left.set(sender.email, left.get(sender.email)! - 1)
        thisTick.set(sender.email, (thisTick.get(sender.email) || 0) + 1)
      }
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
