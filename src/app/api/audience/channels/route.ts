import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { addFromInput } from '@/lib/audience/actions'

export const maxDuration = 30

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const channels = await prisma.audienceChannel.findMany({
    include: { _count: { select: { videos: true } } },
    orderBy: [{ isTracked: 'desc' }, { subscriberCount: 'desc' }],
  })
  return NextResponse.json(channels.map((c) => ({ ...c, viewCount: Number(c.viewCount) })))
}

const schema = z.object({
  input: z.string().trim().min(2, 'Paste a video or channel link, an @handle, or a search phrase'),
  queue: z.boolean().optional(),
})

/** Add a video (optionally straight into the collection queue), a channel, or search channels */
export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  try {
    const r = await addFromInput(parsed.data.input, { queue: parsed.data.queue })
    return NextResponse.json({ ...r, channels: r.channels.map((c) => ({ ...c, viewCount: Number(c.viewCount) })) })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
