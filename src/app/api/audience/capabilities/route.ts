/** GET/PUT /api/audience/capabilities → the Triven capability sheet (what generated text may claim) */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { getCapabilities, saveCapabilities } from '@/lib/audience/capabilities'
import { USE_CASE_KEYS, type UseCase } from '@/lib/audience/usecases'

const schema = z.object({
  product: z.string().trim().min(1).max(60),
  supported: z.array(z.enum(USE_CASE_KEYS as [string, ...string[]])),
  lines: z.record(z.string().max(300)),
  removes: z.string().max(500),
  templateLinks: z.record(z.string().max(300)),
})

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await getCapabilities())
}

export async function PUT(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  const d = parsed.data
  const clean = (r: Record<string, string>) => Object.fromEntries(Object.entries(r).filter(([k, v]) => USE_CASE_KEYS.includes(k as UseCase) && v.trim()).map(([k, v]) => [k, v.trim()]))
  try { new RegExp(d.removes) } catch { return NextResponse.json({ error: 'Blocker words must be separated by |' }, { status: 400 }) }
  const next = { product: d.product, supported: d.supported as UseCase[], lines: clean(d.lines), removes: d.removes, templateLinks: clean(d.templateLinks) }
  await saveCapabilities(next)
  return NextResponse.json(next)
}
