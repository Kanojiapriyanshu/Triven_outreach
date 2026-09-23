import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { scanChannel } from '@/lib/audience/actions'

export const maxDuration = 30

/** Pull the channel's latest uploads and score each one for audience fit (1-2 quota units) */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { max } = await req.json().catch(() => ({})) as { max?: number }
  try {
    const videos = await scanChannel(id, Math.min(200, Math.max(10, max || 50)))
    return NextResponse.json({ videos: videos.sort((a, b) => b.score - a.score) })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
