import { NextRequest, NextResponse } from 'next/server'
import { unsealData } from 'iron-session'
import { sessionOptions } from './lib/auth'
import type { SessionData } from './types'
import { writeBlocked } from './lib/roles'

// Routes that don't require authentication
// (/api/worker and /api/webhooks authenticate themselves: worker secret / provider signature)
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/gmail/callback', '/api/worker', '/api/webhooks']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Allow Next.js internals and static files
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/public') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  // Check session cookie
  const cookieValue = request.cookies.get(sessionOptions.cookieName)?.value

  if (cookieValue) {
    try {
      const session = await unsealData<SessionData>(cookieValue, {
        password: sessionOptions.password,
      })
      if (session.isLoggedIn) {
        // Role check for every API write (roles.ts)
        const blocked = pathname.startsWith('/api/') ? writeBlocked(session.role, pathname, request.method) : null
        if (blocked) return NextResponse.json({ error: blocked }, { status: 403 })
        return NextResponse.next()
      }
    } catch {
      // Invalid/expired cookie – fall through to redirect
    }
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('from', pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
