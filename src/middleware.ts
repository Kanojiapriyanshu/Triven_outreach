import { NextRequest, NextResponse } from 'next/server'
import { unsealData } from 'iron-session'
import { sessionOptions } from './lib/auth'
import type { SessionData } from './types'

// Routes that don't require authentication
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/gmail/callback']

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
