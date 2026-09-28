/** PATCH /api/users/:id { role?, isActive?, password?, name? } (admin only, enforced in middleware) */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

const schema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  role: z.enum(['ADMIN', 'OPERATOR', 'SALES', 'VIEWER']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(10, 'Use at least 10 characters').optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message }, { status: 400 })
  const d = parsed.data
  // Never leave the workspace without an active admin
  if ((d.role && d.role !== 'ADMIN') || d.isActive === false) {
    const target = await prisma.user.findUnique({ where: { id }, select: { role: true } })
    const admins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } })
    if (target?.role === 'ADMIN' && admins <= 1) return NextResponse.json({ error: 'Keep at least one active admin' }, { status: 400 })
  }
  const user = await prisma.user.update({
    where: { id },
    data: { name: d.name, role: d.role, isActive: d.isActive, ...(d.password ? { passwordHash: await bcrypt.hash(d.password, 12) } : {}) },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  })
  return NextResponse.json(user)
}
