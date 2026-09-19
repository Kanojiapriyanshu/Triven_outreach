/**
 * scripts/check-replies.mjs
 * Run by GitHub Actions hourly to scan each connected Gmail inbox for replies
 * from leads and update their status to REPLIED.
 */
import { PrismaClient } from '@prisma/client'
import { google } from 'googleapis'

const prisma = new PrismaClient()

async function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  )
}

async function checkRepliesForAccount(account) {
  const oauth2 = await getOAuthClient()
  oauth2.setCredentials({
    access_token:  account.accessToken,
    refresh_token: account.refreshToken,
    expiry_date:   account.tokenExpiresAt ? new Date(account.tokenExpiresAt).getTime() : undefined,
  })

  // Auto-refresh if expired
  if (account.tokenExpiresAt && new Date(account.tokenExpiresAt) < new Date()) {
    const { credentials } = await oauth2.refreshAccessToken()
    await prisma.senderAccount.update({
      where: { id: account.id },
      data: {
        accessToken:    credentials.access_token,
        tokenExpiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
      },
    })
    oauth2.setCredentials(credentials)
  }

  const gmail = google.gmail({ version: 'v1', auth: oauth2 })

  // Look for inbox messages received in the last 24 hours
  const since = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000)
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: `in:inbox after:${since}`,
    maxResults: 50,
  })

  const messages = listRes.data.messages ?? []
  let repliesFound = 0

  for (const msgRef of messages) {
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id: msgRef.id,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Message-ID', 'In-Reply-To'],
    })

    const headers = msg.data.payload?.headers ?? []
    const fromHeader = headers.find(h => h.name === 'From')?.value ?? ''
    const fromEmail  = fromHeader.match(/[\w.+-]+@[\w.+-]+\.\w+/)?.[0]?.toLowerCase()
    if (!fromEmail) continue

    // Check if this email is from one of our leads
    const lead = await prisma.lead.findFirst({
      where: { companyEmail: { equals: fromEmail, mode: 'insensitive' } },
    })
    if (!lead) continue

    // Skip if already marked as replied
    const terminalStatuses = ['REPLIED', 'INTERESTED', 'WON', 'LOST', 'NOT_INTERESTED', 'UNSUBSCRIBED', 'DO_NOT_CONTACT']
    if (terminalStatuses.includes(lead.status)) continue

    console.log(`Reply detected from ${fromEmail} (lead: ${lead.companyName})`)

    // Update lead status
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        status:         'REPLIED',
        hasReplied:     true,
        lastResponseAt: new Date(),
      },
    })

    // Cancel any pending follow-up tasks
    await prisma.followUpTask.updateMany({
      where: { leadId: lead.id, status: 'PENDING' },
      data:  { status: 'CANCELLED' },
    })

    // Log activity
    await prisma.activity.create({
      data: {
        leadId: lead.id,
        type:   'EMAIL_REPLIED',
        title:  'Reply received',
        body:   `Reply detected from ${fromEmail} via ${account.email}`,
        metadata: { gmailMessageId: msgRef.id, autoDetected: true },
      },
    })

    repliesFound++
  }

  return repliesFound
}

async function main() {
  console.log(`[check-replies] Starting at ${new Date().toISOString()}`)

  const accounts = await prisma.senderAccount.findMany({
    where: { gmailStatus: 'CONNECTED', isActive: true, accessToken: { not: null } },
  })

  console.log(`[check-replies] Checking ${accounts.length} Gmail account(s)`)

  let totalReplies = 0
  for (const account of accounts) {
    try {
      const found = await checkRepliesForAccount(account)
      console.log(`[check-replies] ${account.email}: ${found} new replies`)
      totalReplies += found
    } catch (err) {
      console.error(`[check-replies] Error for ${account.email}:`, err.message)
    }
  }

  console.log(`[check-replies] Done. Total replies found: ${totalReplies}`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(err => { console.error(err); prisma.$disconnect(); process.exit(1) })
