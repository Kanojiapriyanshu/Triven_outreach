import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode, getOAuthClient } from '@/lib/gmail'
import prisma from '@/lib/prisma'
import { google } from 'googleapis'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(new URL(`/sender-accounts?error=${encodeURIComponent(error)}`, req.url))
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/sender-accounts?error=missing_params', req.url))
  }

  try {
    const { senderAccountId } = JSON.parse(Buffer.from(state, 'base64url').toString())
    const tokens = await exchangeCode(code)

    // Get the user's email from Google
    const oauth2 = getOAuthClient()
    oauth2.setCredentials(tokens)
    const oauth2Service = google.oauth2({ version: 'v2', auth: oauth2 })
    const { data: userInfo } = await oauth2Service.userinfo.get()

    await prisma.senderAccount.update({
      where: { id: senderAccountId },
      data: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        gmailStatus: 'CONNECTED',
        // Optionally update email if different
        ...(userInfo.email ? { email: userInfo.email.toLowerCase() } : {}),
      },
    })

    return NextResponse.redirect(new URL('/sender-accounts?connected=1', req.url))
  } catch (err) {
    console.error('[gmail/callback]', err)
    return NextResponse.redirect(new URL('/sender-accounts?error=callback_failed', req.url))
  }
}
