import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { sendFollowUpTask, refreshNextFollowUp } from '@/lib/followups'

const patchSchema = z.object({
  status: z.enum(['PENDING', 'SKIPPED', 'CANCELLED']).optional(),
  scheduledAt: z.coerce.date().optional(),
  body: z.string().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid follow-up update' }, { status: 400 })

  const task = await prisma.followUpTask.update({ where: { id }, data: parsed.data })
  await refreshNextFollowUp(task.leadId)
  return NextResponse.json(task)
}

// POST /api/followups/:id – send the follow-up now (as a reply in the original thread)
// Accepts an optional { body } override so the user can edit before sending
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let bodyOverride: string | undefined
  try {
    const parsed = JSON.parse(await req.text())
    if (typeof parsed?.body === 'string') bodyOverride = parsed.body
  } catch { /* no body – use the stored or default template */ }

  const { id } = await params
  const result = await sendFollowUpTask(id, { bodyOverride, userId: session.userId })

  if (result.outcome === 'sent') return NextResponse.json({ ok: true, gmailMessageId: result.gmailMessageId })
  return NextResponse.json({ error: result.reason }, { status: result.outcome === 'skipped' ? 400 : 500 })
}
