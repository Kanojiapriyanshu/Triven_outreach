/**
 * GET    /api/audience/exclusions → the exclusion list
 * POST   /api/audience/exclusions { kind, values: string[] | string, reason? } → add (one per line allowed)
 * DELETE /api/audience/exclusions?id= → remove
 * Excluded channels / names never become prospects; excluded emails / domains are never emailed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

const schema = z.object({
  kind: z.enum(['CHANNEL', 'DOMAIN', 'EMAIL', 'NAME']),
  values: z.union([z.string(), z.array(z.string())]),
  reason: z.string().trim().max(120).optional(),
})

function normalise(kind: string, raw: string) {
  const v = raw.trim()
  if (!v) return ''
  if (kind === 'CHANNEL') return v.match(/channel\/(UC[\w-]{20,})/)?.[1] || v.match(/news\.ycombinator\.com\/user\?id=([\w-]+)/)?.[1]?.replace(/^/, 'hn:') || v.match(/dev\.to\/([\w-]+)/)?.[1]?.replace(/^/, 'devto:') || v
  if (kind === 'DOMAIN') return v.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/^@/, '').split('/')[0]
  if (kind === 'EMAIL') return v.toLowerCase()
  return v.replace(/^@/, '')
}

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await prisma.exclusionEntry.findMany({ orderBy: { createdAt: 'desc' } }))
}

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  const { kind, reason } = parsed.data
  const raw = Array.isArray(parsed.data.values) ? parsed.data.values : parsed.data.values.split(/[\n,;]+/)
  const values = [...new Set(raw.map((v) => normalise(kind, v)).filter(Boolean))].slice(0, 5000)
  const r = await prisma.exclusionEntry.createMany({ data: values.map((value) => ({ kind, value, reason: reason || null })), skipDuplicates: true })
  // Already-collected people who are now excluded stop being contactable
  if (kind === 'CHANNEL' && values.length) await prisma.prospect.updateMany({ where: { youtubeChannelId: { in: values }, lead: null }, data: { status: 'DO_NOT_CONTACT' } })
  return NextResponse.json({ added: r.count })
}

export async function DELETE(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (id) await prisma.exclusionEntry.delete({ where: { id } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
