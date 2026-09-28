// Reply triage (PRD M8): every reply gets a category, the lead's status follows it,
// unsubscribes are suppressed at once, and a suggested answer is drafted for a human to send.
// Rules always run; the AI (when ANTHROPIC_API_KEY is set) refines and drafts the answer.
import prisma from './prisma'
import { notify } from './notify'
import { aiConfigured, triageReply, describeAiError } from './audience/ai'
import { getCapabilities } from './audience/capabilities'

export type ReplyCategory = 'INTERESTED' | 'MEETING' | 'QUESTION' | 'NOT_NOW' | 'NOT_INTERESTED' | 'UNSUBSCRIBE' | 'OUT_OF_OFFICE' | 'REFERRAL' | 'OTHER'

export const REPLY_LABEL: Record<ReplyCategory, string> = {
  INTERESTED: 'Interested', MEETING: 'Wants a call', QUESTION: 'Question', NOT_NOW: 'Not now', NOT_INTERESTED: 'Not interested',
  UNSUBSCRIBE: 'Unsubscribe', OUT_OF_OFFICE: 'Out of office', REFERRAL: 'Referral', OTHER: 'Other',
}

/** Only the part they wrote: drop quoted history and signatures */
function ownText(body: string) {
  return body.split(/\n\s*(On .{5,120} wrote:|-{2,}\s*Original Message|From: .+\n|>)/i)[0].slice(0, 3000).trim()
}

export function rulesTriage(raw: string): ReplyCategory {
  const t = ownText(raw).toLowerCase()
  if (/\b(unsubscribe|remove me|take me off|stop (emailing|contacting|sending)|do not (contact|email)|opt me out|don'?t (email|contact) me)\b/.test(t)) return 'UNSUBSCRIBE'
  if (/\b(out of (the )?office|on (annual )?leave|on vacation|away until|back on|limited access to email)\b/.test(t)) return 'OUT_OF_OFFICE'
  if (/\b(not interested|no thanks|no thank you|not a fit|we'?re (all )?(good|set)|not for us|no need|pass on this)\b/.test(t)) return 'NOT_INTERESTED'
  if (/\b(reach out to|contact|speak (to|with)|talk to|forward(ed)? (this|you) to|the right person (is|would be)|cc'?(d|ing))\b[^.]{0,60}@/.test(t)) return 'REFERRAL'
  if (/\b(book|schedule|set up|jump on|hop on) (a |an )?(call|meeting|chat|demo|time)|\b(calendar|calendly|cal\.com|zoom|google meet|available (on|at|this|next)|free (on|at|this|next))\b/.test(t)) return 'MEETING'
  if (/\b(not (right )?now|maybe later|next (month|quarter|year)|in a few (weeks|months)|circle back|reach out (again )?(in|later)|busy (right now|at the moment))\b/.test(t)) return 'NOT_NOW'
  if (/\b(interested|sounds (good|great|interesting)|tell me more|send (it|me|over|the template)|yes please|sure|love to|would like|keen|access|demo|let'?s (do|try) it)\b/.test(t)) return 'INTERESTED'
  if (t.includes('?')) return 'QUESTION'
  return 'OTHER'
}

const LATER_STATUSES = ['INTERESTED', 'DEMO_SENT', 'MEETING_BOOKED', 'PROPOSAL_SENT', 'WON', 'LOST']

/** Categorise a reply, move the lead, suppress, notify. Never throws (a reply must never be lost to triage). */
export async function triageLeadReply(leadId: string, replyBody: string) {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, fullName: true, companyName: true, companyEmail: true, status: true, whyThisLead: true, prospectingNotes: true, prospectId: true, businessId: true, firstEmailBody: true },
    })
    if (!lead) return null
    let category: ReplyCategory = rulesTriage(replyBody)
    let suggestion: string | null = null
    let referral = ''
    if (aiConfigured() && category !== 'UNSUBSCRIBE') {
      try {
        const r = await triageReply({
          reply: ownText(replyBody), ourEmail: lead.firstEmailBody || '', leadName: lead.fullName || lead.companyName,
          context: [lead.whyThisLead, lead.prospectingNotes].filter(Boolean).join('\n'),
        }, await getCapabilities())
        category = r.category
        suggestion = r.suggested_reply.trim() || null
        referral = r.referral_email.trim()
      } catch (err) {
        console.error('reply triage AI failed', describeAiError(err))
      }
    }

    const keep = LATER_STATUSES.includes(lead.status)
    const status = category === 'UNSUBSCRIBE' ? 'UNSUBSCRIBED'
      : category === 'NOT_INTERESTED' ? (keep ? lead.status : 'NOT_INTERESTED')
      : category === 'INTERESTED' || category === 'MEETING' ? (keep ? lead.status : 'INTERESTED')
      : lead.status
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        replyCategory: category, replySuggestion: suggestion, status,
        ...(category === 'INTERESTED' || category === 'MEETING' ? { isInterested: true } : {}),
      },
    })

    if (category === 'UNSUBSCRIBE' && lead.companyEmail) {
      const email = lead.companyEmail.toLowerCase()
      await prisma.suppressionEntry.upsert({ where: { email }, create: { email, reason: 'UNSUBSCRIBED' }, update: {} })
      await prisma.followUpTask.updateMany({ where: { leadId: lead.id, status: 'PENDING' }, data: { status: 'CANCELLED' } })
      if (lead.prospectId) await prisma.prospect.update({ where: { id: lead.prospectId }, data: { status: 'DO_NOT_CONTACT' } }).catch(() => null)
      if (lead.businessId) await prisma.business.update({ where: { id: lead.businessId }, data: { status: 'DO_NOT_CONTACT' } }).catch(() => null)
    }
    await prisma.activity.create({ data: { leadId: lead.id, type: 'OTHER', title: `Reply sorted: ${REPLY_LABEL[category]}`, metadata: { category, referral: referral || undefined } } })

    const who = lead.fullName || lead.companyName
    if (category === 'MEETING') await notify({ type: 'MEETING', title: `${who} wants a call`, body: 'Reply with times, or send your booking link.', leadId: lead.id, href: `/inbox?lead=${lead.id}` })
    else if (category === 'INTERESTED') await notify({ type: 'REPLY', title: `${who} is interested`, body: suggestion ? 'A suggested reply is ready in the inbox.' : 'Reply while it\'s fresh.', leadId: lead.id, href: `/inbox?lead=${lead.id}` })
    else if (category === 'REFERRAL') await notify({ type: 'REPLY', title: `${who} referred you to someone`, body: referral ? `Suggested contact: ${referral}` : 'Open the reply to see who.', leadId: lead.id, href: `/inbox?lead=${lead.id}` })
    return category
  } catch (err) {
    console.error('triage failed', err)
    return null
  }
}

/** Bounce guard: 2+ bounces in 24 h pauses that inbox for a day (its reputation matters more than today's sends) */
export async function bounceGuard(senderEmail: string) {
  const since = new Date(Date.now() - 86_400_000)
  const bounces = await prisma.emailMessage.count({
    where: { direction: 'INBOUND', toAddress: senderEmail, receivedAt: { gte: since }, OR: [{ fromAddress: { contains: 'mailer-daemon', mode: 'insensitive' } }, { fromAddress: { contains: 'postmaster', mode: 'insensitive' } }] },
  })
  if (bounces < 2) return false
  const sender = await prisma.senderAccount.findUnique({ where: { email: senderEmail } })
  if (!sender || (sender.pausedUntil && sender.pausedUntil > new Date())) return false
  await prisma.senderAccount.update({ where: { id: sender.id }, data: { pausedUntil: new Date(Date.now() + 86_400_000), pauseReason: `${bounces} bounces in 24 h` } })
  await notify({ type: 'BOUNCE', title: `${senderEmail} paused for 24 h`, body: `${bounces} bounces in a day. Check the list quality (verified emails only) before it resumes.`, href: '/sender-accounts', group: `inbox-pause:${sender.id}`, cooldownHours: 20 })
  return true
}
