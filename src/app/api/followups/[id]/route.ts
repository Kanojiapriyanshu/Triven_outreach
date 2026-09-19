import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { sendGmail } from '@/lib/gmail'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  const task = await prisma.followUpTask.update({
    where: { id },
    data: body,
  })

  return NextResponse.json(task)
}

// POST /api/followups/:id – send the follow-up via Gmail
// Accepts optional { subject, body } overrides so the user can edit before sending
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  // Also allow worker requests authenticated by WORKER_SECRET header
  const workerSecret = req.headers.get('x-worker-secret')
  const isWorker = workerSecret && workerSecret === process.env.WORKER_SECRET
  if (!session && !isWorker) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Parse optional overrides from body
  let subjectOverride: string | undefined
  let bodyOverride: string | undefined
  try {
    const rawBody = await req.text()
    if (rawBody) {
      const parsed = JSON.parse(rawBody)
      subjectOverride = parsed.subject
      bodyOverride    = parsed.body
    }
  } catch { /* no body or invalid JSON – fine, use stored template */ }

  const { id } = await params
  const task = await prisma.followUpTask.findUnique({
    where: { id },
    include: {
      lead: true,
      senderAccount: true,
    },
  })

  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!task.lead.companyEmail) return NextResponse.json({ error: 'Lead has no email address' }, { status: 400 })

  const senderAccountId = task.senderAccountId || task.lead.senderAccountId
  if (!senderAccountId) return NextResponse.json({ error: 'No sender account assigned' }, { status: 400 })

  try {
    const gmailMessage = await sendGmail({
      senderAccountId,
      to: task.lead.companyEmail,
      subject: subjectOverride ?? task.subject ?? 'Following up',
      body:    bodyOverride    ?? task.body    ?? '',
    })

    // Mark task as sent
    await prisma.followUpTask.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date() },
    })

    // Update lead status
    const statusMap: Record<string, string> = {
      FOLLOW_UP_1: 'FOLLOW_UP_1_SENT',
      FOLLOW_UP_2: 'FOLLOW_UP_2_SENT',
      FOLLOW_UP_3: 'FOLLOW_UP_3_SENT',
    }
    const newStatus = statusMap[task.type]
    const sentAtField = {
      FOLLOW_UP_1: { followUp1SentAt: new Date() },
      FOLLOW_UP_2: { followUp2SentAt: new Date() },
      FOLLOW_UP_3: { followUp3SentAt: new Date() },
    }[task.type] || {}

    await prisma.lead.update({
      where: { id: task.leadId },
      data: {
        status: newStatus || undefined,
        lastContactedAt: new Date(),
        ...sentAtField,
      },
    })

    // Log activity
    await prisma.activity.create({
      data: {
        leadId: task.leadId,
        userId: session?.userId,
        senderAccountId,
        type: 'FOLLOW_UP_SENT',
        title: `${task.type.replace('_', ' ')} sent`,
        body: task.subject,
        metadata: { gmailMessageId: gmailMessage.id, taskId: id },
      },
    })

    return NextResponse.json({ ok: true, gmailMessageId: gmailMessage.id })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to send email'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
