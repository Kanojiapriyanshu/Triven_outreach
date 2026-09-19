/**
 * POST /api/worker
 * Background worker endpoint — called by GitHub Actions on a cron schedule.
 * Authenticated by the X-Worker-Secret header (never a user session).
 *
 * Body: { action: 'process_followups' | 'check_replies' }
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { sendGmail } from '@/lib/gmail'

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

    // Find all PENDING tasks due now or in the past
    const tasks = await prisma.followUpTask.findMany({
      where: {
        status: 'PENDING',
        scheduledAt: { lte: now },
      },
      include: {
        lead: true,
      },
      take: 50, // process in batches
    })

    const results = { sent: 0, skipped: 0, failed: 0, errors: [] as string[] }

    for (const task of tasks) {
      // Skip if lead is in a terminal status or no email
      const terminalStatuses = ['REPLIED', 'INTERESTED', 'WON', 'LOST', 'NOT_INTERESTED', 'UNSUBSCRIBED', 'DO_NOT_CONTACT', 'INVALID_EMAIL']
      if (terminalStatuses.includes(task.lead.status)) {
        await prisma.followUpTask.update({ where: { id: task.id }, data: { status: 'SKIPPED' } })
        results.skipped++
        continue
      }

      if (!task.lead.companyEmail) {
        await prisma.followUpTask.update({ where: { id: task.id }, data: { status: 'SKIPPED' } })
        results.skipped++
        continue
      }

      const senderAccountId = task.senderAccountId || task.lead.senderAccountId
      if (!senderAccountId) { results.skipped++; continue }

      try {
        const gmailMessage = await sendGmail({
          senderAccountId,
          to: task.lead.companyEmail,
          subject: task.subject ?? 'Following up',
          body:    task.body    ?? '',
        })

        await prisma.followUpTask.update({
          where: { id: task.id },
          data: { status: 'SENT', sentAt: new Date() },
        })

        const statusMap: Record<string, string> = {
          FOLLOW_UP_1: 'FOLLOW_UP_1_SENT',
          FOLLOW_UP_2: 'FOLLOW_UP_2_SENT',
          FOLLOW_UP_3: 'FOLLOW_UP_3_SENT',
        }
        const sentAtField = {
          FOLLOW_UP_1: { followUp1SentAt: new Date() },
          FOLLOW_UP_2: { followUp2SentAt: new Date() },
          FOLLOW_UP_3: { followUp3SentAt: new Date() },
        }[task.type] || {}

        await prisma.lead.update({
          where: { id: task.leadId },
          data: { status: statusMap[task.type] || undefined, lastContactedAt: new Date(), ...sentAtField },
        })

        await prisma.activity.create({
          data: {
            leadId: task.leadId,
            senderAccountId,
            type: 'FOLLOW_UP_SENT',
            title: `${task.type.replace(/_/g, ' ')} sent (auto)`,
            body: task.subject,
            metadata: { gmailMessageId: gmailMessage.id, taskId: task.id, auto: true },
          },
        })

        results.sent++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        results.errors.push(`Task ${task.id}: ${msg}`)
        results.failed++
      }
    }

    return NextResponse.json({ ok: true, action, results, processedAt: now.toISOString() })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
