import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { getSession } from '@/lib/auth'
import prisma from '@/lib/prisma'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password } = loginSchema.parse(body)

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    })

    if (!user || !user.isActive) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const session = await getSession()
    session.userId = user.id
    session.email = user.email
    session.name = user.name
    session.role = user.role
    session.isLoggedIn = true
    await session.save()

    return NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    console.error('[auth/login]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
