/** GET /api/users → team members · POST { name, email, password, role } → add one (admin only, enforced in middleware) */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email(),
  password: z.string().min(10, 'Use at least 10 characters'),
  role: z.enum(['ADMIN', 'OPERATOR', 'SALES', 'VIEWER']),
})

export async function GET() {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true } })
  return NextResponse.json({ users, me: session.userId, myRole: session.role })
}

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  const d = parsed.data
  const email = d.email.toLowerCase()
  if (await prisma.user.findUnique({ where: { email } })) return NextResponse.json({ error: 'Someone with that email already exists' }, { status: 400 })
  const user = await prisma.user.create({
    data: { name: d.name, email, role: d.role, passwordHash: await bcrypt.hash(d.password, 12) },
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
  })
  return NextResponse.json(user, { status: 201 })
}
