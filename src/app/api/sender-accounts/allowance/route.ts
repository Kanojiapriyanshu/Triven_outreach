import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { dailyAllowance } from '@/lib/outreach'
import { getSettings } from '@/lib/settings'

// GET /api/sender-accounts/allowance → today's sending allowance per account (warm-up aware)
export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { dailyCapPerSender } = await getSettings()
  const senders = await prisma.senderAccount.findMany({ select: { id: true, email: true, dailyEmailTarget: true } })
  const entries = await Promise.all(senders.map(async (s) => [s.id, await dailyAllowance(s, dailyCapPerSender)] as const))
  return NextResponse.json(Object.fromEntries(entries))
}
