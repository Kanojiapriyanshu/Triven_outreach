import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { queueVideos } from '@/lib/audience/actions'

export async function GET(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const status = sp.get('status')?.split(',').filter(Boolean)
  const channelId = sp.get('channelId')
  const videos = await prisma.audienceVideo.findMany({
    where: { ...(status?.length ? { status: { in: status } } : {}), ...(channelId ? { channelId } : {}) },
    include: {
      channel: { select: { id: true, title: true, handle: true } },
      _count: { select: { comments: { where: { relevance: { in: ['HIGH', 'MEDIUM'] } } } } },
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 300,
  })
  return NextResponse.json(videos.map(({ _count, ...v }) => ({ ...v, relevantComments: _count.comments })))
}

const actionSchema = z.object({
  action: z.enum(['queue', 'skip', 'delete']),
  ids: z.array(z.string()).min(1),
  maxComments: z.number().int().min(100).max(20000).optional(),
})

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = actionSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  const { action, ids, maxComments } = parsed.data
  if (action === 'queue') return NextResponse.json({ ok: true, count: await queueVideos(ids, maxComments) })
  if (action === 'skip') {
    const r = await prisma.audienceVideo.updateMany({ where: { id: { in: ids } }, data: { status: 'SKIPPED' } })
    return NextResponse.json({ ok: true, count: r.count })
  }
  // Deleting a video deletes its comments; prospects keep any comments from other videos
  const r = await prisma.audienceVideo.deleteMany({ where: { id: { in: ids } } })
  await prisma.prospect.deleteMany({ where: { comments: { none: {} }, lead: null, emails: { none: {} } } })
  return NextResponse.json({ ok: true, count: r.count })
}
