/**
 * POST /api/webhooks/calendar   (Cal.com or Calendly booking webhooks)
 * A booked or cancelled meeting updates the matching lead (by attendee email): status, meeting
 * date, activity and a notification. Authenticated by the provider's signature using
 * CALENDAR_WEBHOOK_SECRET (Cal.com: X-Cal-Signature-256; Calendly: Calendly-Webhook-Signature),
 * or ?secret=<CALENDAR_WEBHOOK_SECRET> for tools that can't sign.
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import prisma from '@/lib/prisma'
import { notify } from '@/lib/notify'

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

function verified(req: NextRequest, raw: string) {
  const secret = process.env.CALENDAR_WEBHOOK_SECRET
  if (!secret) return false
  const cal = req.headers.get('x-cal-signature-256')
  if (cal) return safeEqual(crypto.createHmac('sha256', secret).update(raw).digest('hex'), cal)
  const calendly = req.headers.get('calendly-webhook-signature')
  if (calendly) {
    const parts = Object.fromEntries(calendly.split(',').map((p) => p.split('=') as [string, string]))
    if (!parts.t || !parts.v1 || Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) return false
    return safeEqual(crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex'), parts.v1)
  }
  const q = new URL(req.url).searchParams.get('secret')
  return !!q && safeEqual(q, secret)
}

interface Booking { emails: string[]; start: Date | null; title: string; cancelled: boolean }

function parse(body: Record<string, unknown>): Booking | null {
  // Cal.com
  if (typeof body.triggerEvent === 'string') {
    const p = (body.payload || {}) as { attendees?: Array<{ email?: string }>; startTime?: string; title?: string }
    if (!/BOOKING_(CREATED|RESCHEDULED|CANCELLED)/.test(body.triggerEvent)) return null
    return { emails: (p.attendees || []).map((a) => a.email || '').filter(Boolean), start: p.startTime ? new Date(p.startTime) : null, title: p.title || 'Meeting', cancelled: body.triggerEvent === 'BOOKING_CANCELLED' }
  }
  // Calendly
  if (typeof body.event === 'string' && /^invitee\./.test(body.event)) {
    const p = (body.payload || {}) as { email?: string; scheduled_event?: { start_time?: string; name?: string } }
    return { emails: p.email ? [p.email] : [], start: p.scheduled_event?.start_time ? new Date(p.scheduled_event.start_time) : null, title: p.scheduled_event?.name || 'Meeting', cancelled: body.event === 'invitee.canceled' }
  }
  return null
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!verified(req, raw)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: Record<string, unknown>
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const b = parse(body)
  if (!b) return NextResponse.json({ ok: true, ignored: true })

  const emails = b.emails.map((e) => e.toLowerCase())
  const lead = await prisma.lead.findFirst({
    where: { OR: [{ companyEmail: { in: emails, mode: 'insensitive' } }, { prospect: { emails: { some: { email: { in: emails } } } } }] },
    orderBy: { updatedAt: 'desc' },
  })
  if (!lead) {
    await notify({ type: 'MEETING', title: `${b.cancelled ? 'Meeting cancelled' : 'Meeting booked'} by ${emails[0] || 'someone'}`, body: `${b.title}${b.start ? ` · ${b.start.toUTCString()}` : ''} · no matching lead in the CRM`, href: '/leads' })
    return NextResponse.json({ ok: true, matched: false })
  }

  if (b.cancelled) {
    await prisma.lead.update({ where: { id: lead.id }, data: { meetingBooked: false, meetingDate: null, ...(lead.status === 'MEETING_BOOKED' ? { status: 'INTERESTED' } : {}) } })
    await prisma.activity.create({ data: { leadId: lead.id, type: 'OTHER', title: `Meeting cancelled: ${b.title}` } })
    await notify({ type: 'MEETING', title: `${lead.fullName || lead.companyName} cancelled the meeting`, leadId: lead.id, href: `/leads/${lead.id}` })
  } else {
    const later = ['PROPOSAL_SENT', 'WON'].includes(lead.status)
    await prisma.lead.update({
      where: { id: lead.id },
      data: { meetingBooked: true, meetingDate: b.start, hasReplied: true, isInterested: true, nextFollowUpAt: null, ...(later ? {} : { status: 'MEETING_BOOKED' }) },
    })
    await prisma.followUpTask.updateMany({ where: { leadId: lead.id, status: 'PENDING' }, data: { status: 'CANCELLED' } })
    await prisma.activity.create({ data: { leadId: lead.id, type: 'MEETING_BOOKED', title: `Meeting booked: ${b.title}`, metadata: { start: b.start?.toISOString() } } })
    await notify({ type: 'MEETING', title: `Meeting booked with ${lead.fullName || lead.companyName}`, body: b.start ? b.start.toUTCString() : b.title, leadId: lead.id, href: `/leads/${lead.id}` })
  }
  return NextResponse.json({ ok: true, matched: true, leadId: lead.id })
}
