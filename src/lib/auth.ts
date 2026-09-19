import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import type { SessionData } from '@/types'

export const sessionOptions = {
  password: process.env.SESSION_SECRET || 'fallback-secret-change-in-production-32chars!!',
  cookieName: 'triven_crm_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
}

export async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, sessionOptions)
}

export async function requireAuth() {
  const session = await getSession()
  if (!session.isLoggedIn) {
    return null
  }
  return session
}
