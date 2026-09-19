// Gmail OAuth + API helpers
// Uses googleapis library – tokens stored in DB, never in client

import { google } from 'googleapis'
import prisma from './prisma'

export function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  )
}

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

export function buildAuthUrl(state: string) {
  const oauth2 = getOAuthClient()
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: GMAIL_SCOPES,
    prompt: 'consent',
    state,
  })
}

export async function exchangeCode(code: string) {
  const oauth2 = getOAuthClient()
  const { tokens } = await oauth2.getToken(code)
  return tokens
}

export async function getGmailClientForAccount(senderAccountId: string) {
  const account = await prisma.senderAccount.findUniqueOrThrow({
    where: { id: senderAccountId },
    select: { accessToken: true, refreshToken: true, tokenExpiresAt: true, email: true },
  })

  if (!account.refreshToken) {
    throw new Error(`Sender account ${senderAccountId} has no refresh token – reconnect Gmail`)
  }

  const oauth2 = getOAuthClient()
  oauth2.setCredentials({
    access_token: account.accessToken,
    refresh_token: account.refreshToken,
    expiry_date: account.tokenExpiresAt?.getTime(),
  })

  // Auto-refresh if token is expired / close to expiring
  const expiresAt = account.tokenExpiresAt?.getTime() ?? 0
  if (Date.now() > expiresAt - 60_000) {
    const { credentials } = await oauth2.refreshAccessToken()
    oauth2.setCredentials(credentials)
    await prisma.senderAccount.update({
      where: { id: senderAccountId },
      data: {
        accessToken: credentials.access_token,
        tokenExpiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
        gmailStatus: 'CONNECTED',
      },
    })
  }

  return google.gmail({ version: 'v1', auth: oauth2 })
}

/** Encode a raw MIME message for the Gmail API */
export function encodeMimeMessage(opts: {
  from: string
  to: string
  subject: string
  body: string
  threadId?: string
  inReplyTo?: string
}) {
  const mime = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : '',
    '',
    opts.body,
  ]
    .filter((l) => l !== null)
    .join('\r\n')

  return Buffer.from(mime).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Send an email via the Gmail API */
export async function sendGmail(opts: {
  senderAccountId: string
  to: string
  subject: string
  body: string
  threadId?: string
  inReplyTo?: string
}) {
  const account = await prisma.senderAccount.findUniqueOrThrow({
    where: { id: opts.senderAccountId },
    select: { email: true, displayName: true, signature: true },
  })

  const gmail = await getGmailClientForAccount(opts.senderAccountId)
  const bodyWithSig = account.signature
    ? `${opts.body}\n\n--\n${account.signature}`
    : opts.body

  const raw = encodeMimeMessage({
    from: `${account.displayName} <${account.email}>`,
    to: opts.to,
    subject: opts.subject,
    body: bodyWithSig.replace(/\n/g, '<br>'),
    threadId: opts.threadId,
    inReplyTo: opts.inReplyTo,
  })

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw, threadId: opts.threadId },
  })

  return response.data
}
