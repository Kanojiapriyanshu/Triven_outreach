import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { sendGmail, getMessageIdHeader } from '@/lib/gmail'
import { assertSendable, OutreachError } from '@/lib/outreach'

// GET: the whole conversation with this lead (marks their replies as read)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ leadId: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leadId } = await params
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      senderAccount: { select: { id: true, displayName: true, email: true, gmailStatus: true } },
      campaign: { select: { name: true } },
      emailMessages: { orderBy: { createdAt: 'asc' } },
      followUpTasks: { where: { status: 'PENDING' }, orderBy: { scheduledAt: 'asc' } },
    },
  })
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.emailMessage.updateMany({ where: { leadId, direction: 'INBOUND', isRead: false }, data: { isRead: true } })
  return NextResponse.json(lead)
}

const replySchema = z.object({ body: z.string().trim().min(1, 'Write a reply first') })

// POST: reply in the same Gmail thread, from the inbox that owns the conversation
export async function POST(req: NextRequest, { params }: { params: Promise<{ leadId: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = replySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })

  const { leadId } = await params
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { senderAccount: true } })
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const sender = await assertSendable(lead, lead.senderAccount)
    // Answer their latest message, in its thread
    const lastInbound = await prisma.emailMessage.findFirst({
      where: { leadId, direction: 'INBOUND', gmailMessageId: { not: null } },
      orderBy: { createdAt: 'desc' },
    })
    const anchor = lastInbound ?? await prisma.emailMessage.findFirst({
      where: { leadId, gmailThreadId: { not: null } },
      orderBy: { createdAt: 'desc' },
    })
    const baseSubject = anchor?.subject || lead.firstEmailSubject || 'Following up'
    const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`
    const inReplyTo = anchor?.gmailMessageId ? await getMessageIdHeader(sender.id, anchor.gmailMessageId) : undefined

    const sent = await sendGmail({
      senderAccountId: sender.id,
      to: lead.companyEmail!,
      subject,
      body: parsed.data.body,
      threadId: anchor?.gmailThreadId || undefined,
      inReplyTo,
    })
    const now = new Date()
    const message = await prisma.emailMessage.create({
      data: {
        leadId, direction: 'OUTBOUND', subject, body: parsed.data.body,
        fromAddress: sender.email, toAddress: lead.companyEmail, sentAt: now, isRead: true,
        gmailMessageId: sent.id || undefined, gmailThreadId: sent.threadId || anchor?.gmailThreadId || undefined,
      },
    })
    await prisma.lead.update({ where: { id: leadId }, data: { lastContactedAt: now } })
    await prisma.activity.create({
      data: { leadId, userId: session.userId, senderAccountId: sender.id, type: 'EMAIL_SENT', title: `Replied: ${subject}` },
    })
    return NextResponse.json(message)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to send'
    return NextResponse.json({ error: msg }, { status: err instanceof OutreachError ? 400 : 500 })
  }
}
