import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { addManualEmail } from '@/lib/audience/actions'
import { verifyPending } from '@/lib/audience/pipeline'

export const maxDuration = 30

/** Add an address found by hand (e.g. on LinkedIn), then verify it right away */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { email } = await req.json() as { email?: string }
  try {
    const row = await addManualEmail(id, email || '')
    await verifyPending(Date.now() + 20_000, [id])
    return NextResponse.json(row, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
