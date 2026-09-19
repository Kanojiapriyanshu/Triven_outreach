import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { buildAuthUrl } from '@/lib/gmail'

export async function GET(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const senderAccountId = searchParams.get('senderAccountId')

  if (!senderAccountId) {
    return NextResponse.json({ error: 'senderAccountId required' }, { status: 400 })
  }

  const state = Buffer.from(JSON.stringify({ senderAccountId, userId: session.userId })).toString('base64url')
  const url = buildAuthUrl(state)

  return NextResponse.json({ url })
}
