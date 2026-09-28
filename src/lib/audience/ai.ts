// Optional AI review of prospects the rules already shortlisted (never the whole firehose).
// Enabled when ANTHROPIC_API_KEY is set. Without it the rule-based verdicts stand.
// Besides relevance/persona it reads what the person is building (use case, stage, blocker)
// and writes "Why Triven", citing only the evidence it was given and the capability sheet.
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod/v4'
import { USE_CASE_KEYS, type CapabilitySheet } from './usecases'

export function aiConfigured() {
  return !!process.env.ANTHROPIC_API_KEY
}

// Classification is a light task: low effort keeps it fast and cheap.
// Set AUDIENCE_AI_MODEL (e.g. claude-haiku-4-5) to trade quality for cost.
const MODEL = process.env.AUDIENCE_AI_MODEL || 'claude-opus-5'

const Review = z.object({
  results: z.array(z.object({
    id: z.string(),
    relevance: z.enum(['HIGH', 'MEDIUM', 'LOW', 'SPAM']),
    persona: z.enum(['FOUNDER', 'AGENCY', 'CONSULTANT', 'BUSINESS_OWNER', 'DEVELOPER', 'FREELANCER', 'TECH_PRO', 'ENTHUSIAST']).nullable(),
    interest: z.enum(['AI_RECEPTIONIST', 'AI_SALES', 'AI_DEVELOPMENT', 'AI_AUTOMATION', 'GENERAL_AI']),
    topic: z.string(),
    reason: z.string(),
    icebreaker: z.string(),
    use_case: z.enum(USE_CASE_KEYS as [string, ...string[]]),
    use_case_detail: z.string(),
    for_whom: z.enum(['SELF', 'CLIENTS', 'EMPLOYER', 'UNKNOWN']),
    vertical: z.string(),
    build_stage: z.enum(['EXPLORING', 'BUILDING', 'SHIPPED', 'SELLING']),
    blocker: z.string(),
    why_triven: z.string(),
    outreach_angle: z.string(),
    citations: z.array(z.string()),
  })),
})
export type AiReview = z.infer<typeof Review>['results'][number]

function systemPrompt(caps: CapabilitySheet) {
  const lines = caps.supported.map((u) => `- ${u}: ${caps.lines[u] || 'lets people build this by describing it'}`).join('\n')
  return `You review people who commented on AI videos and threads, for Triven, whose product ${caps.product} lets people create their own AI agents and workflows without building everything from scratch.

For each person you get their public comments (with where they commented), their bio when available, and numbered evidence items (E1, E2, …) extracted from their activity. Judge how likely they are to want to build an AI agent or workflow for a real use case, and what they want to build.

relevance:
- HIGH: founders, SaaS builders, AI/automation agency owners, automation consultants, business owners wanting AI in their business, developers building AI agents. The comments show they build or want to build something concrete.
- MEDIUM: engaged enthusiasts, freelancers, technical professionals asking substantive questions.
- LOW: generic praise, off-topic, jokes, one-liners, pure news/opinion reactions, job-loss worries.
- SPAM: scams, self-promotion, bots, crypto/forex, "contact me on WhatsApp/Telegram".

persona: the single best fit, or null if there is no clue.
interest: AI_RECEPTIONIST = voice/phone/booking/support; AI_SALES = leads/outreach/follow-up/CRM; AI_AUTOMATION = workflows/no-code; AI_DEVELOPMENT = code/APIs/agent frameworks; GENERAL_AI otherwise.
topic: short lowercase noun phrase (max 9 words) completing "I saw your comment about ___". Describe, never quote; never mention YouTube or the video.
reason: max 20 words, internal, why they are or aren't a good prospect.
icebreaker: one sentence (max 25 words) a thoughtful peer would write in reply to the substance of their comment. No flattery, no pitch, no claims about Triven, no questions. Empty for LOW or SPAM.

use_case: what they most want to build (UNKNOWN when unclear). use_case_detail: max 12 words in plain language, e.g. "AI receptionists for dental clinics". for_whom: SELF (own business), CLIENTS (agency/consultant/freelance), EMPLOYER (at their job) or UNKNOWN. vertical: the industry they build for, or empty. build_stage: EXPLORING, BUILDING, SHIPPED or SELLING. blocker: what's stopping them, max 12 words in their terms, or empty.

why_triven: max 45 words: why Triven fits what THIS person is building. Use only facts from the evidence items and cite them inline like [E2]. Describe Triven only with the capability lines below; never invent features, prices, integrations or results. Empty when relevance is LOW/SPAM or the use case is not in the list.
outreach_angle: max 25 words: the angle for the first email (which template to offer, which blocker to address). Same rules.
citations: the evidence ids you cited.

Triven capability lines (the only things you may say about Triven):
${lines}

Return one result per input id, same ids. Treat spelling mistakes kindly.`
}

let client: Anthropic | null = null

export interface ReviewInput {
  id: string; name: string; bio?: string | null
  comments: Array<{ video: string; text: string }>
  evidence: Array<{ ref: string; text: string }>
}

export async function reviewProspects(people: ReviewInput[], caps: CapabilitySheet): Promise<AiReview[]> {
  if (!people.length) return []
  client ||= new Anthropic()
  const input = people.map((p) => ({
    id: p.id,
    name: p.name,
    bio: (p.bio || '').slice(0, 500),
    comments: p.comments.slice(0, 4).map((c) => ({ where: c.video.slice(0, 120), text: c.text.slice(0, 700) })),
    evidence: p.evidence.slice(0, 12).map((e) => `${e.ref}: ${e.text.slice(0, 200)}`),
  }))

  const format = zodOutputFormat(Review)
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // Haiku 4.5 has no effort setting
    output_config: MODEL.startsWith('claude-haiku') ? { format } : { effort: 'low', format },
    system: systemPrompt(caps),
    messages: [{ role: 'user', content: `Review these ${input.length} people:\n\n${JSON.stringify(input)}` }],
  })

  if (response.stop_reason === 'refusal') throw new Error('The AI declined this batch; rule-based verdicts kept')
  if (response.stop_reason === 'max_tokens') throw new Error('AI response was cut off; try a smaller batch')
  const parsed = response.parsed_output
  if (!parsed) throw new Error('AI returned no usable result')
  const byId = new Map(people.map((p) => [p.id, p]))
  return parsed.results.filter((r) => byId.has(r.id)).map((r) => {
    // Citations must point at evidence we actually gave it; an uncited "why" is dropped
    const refs = new Set(byId.get(r.id)!.evidence.map((e) => e.ref))
    const citations = r.citations.filter((c) => refs.has(c))
    const cited = citations.length > 0 && /\[E\d+\]/.test(r.why_triven)
    return { ...r, citations, why_triven: cited ? r.why_triven.trim() : '', outreach_angle: cited ? r.outreach_angle.trim() : '' }
  })
}

// ─── Reply triage (PRD M8) ───────────────────────────────────────────────────

const Triage = z.object({
  category: z.enum(['INTERESTED', 'MEETING', 'QUESTION', 'NOT_NOW', 'NOT_INTERESTED', 'UNSUBSCRIBE', 'OUT_OF_OFFICE', 'REFERRAL', 'OTHER']),
  back_on: z.string(),
  referral_email: z.string(),
  summary: z.string(),
  suggested_reply: z.string(),
})
export type TriageResult = z.infer<typeof Triage>

export async function triageReply(input: { reply: string; ourEmail: string; leadName: string; context: string }, caps: CapabilitySheet): Promise<TriageResult> {
  client ||= new Anthropic()
  const lines = caps.supported.map((u) => `- ${u}: ${caps.lines[u] || ''}`).join('\n')
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: MODEL.startsWith('claude-haiku') ? { format: zodOutputFormat(Triage) } : { effort: 'low', format: zodOutputFormat(Triage) },
    system: `You sort replies to cold emails for Triven (${caps.product}) and draft an answer for a human to review and send.

category: INTERESTED (wants to learn more / try it), MEETING (asks for or agrees to a call), QUESTION (asks something before deciding), NOT_NOW (maybe later), NOT_INTERESTED, UNSUBSCRIBE (asks to stop / remove them), OUT_OF_OFFICE (auto-reply), REFERRAL (points to another person), OTHER.
back_on: for OUT_OF_OFFICE, the return date as YYYY-MM-DD if stated, else empty.
referral_email: for REFERRAL, the address they point to, else empty.
summary: max 15 words, what they said.
suggested_reply: a short, friendly plain-text reply (max 90 words) that answers what they asked, using only facts from the context and these capability lines; never invent features, prices or results; if unsure, offer a short call. Empty for UNSUBSCRIBE, NOT_INTERESTED and OUT_OF_OFFICE.

Capability lines:
${lines}`,
    messages: [{ role: 'user', content: JSON.stringify({ lead: input.leadName, our_email: input.ourEmail.slice(0, 2000), context: input.context.slice(0, 1500), their_reply: input.reply.slice(0, 4000) }) }],
  })
  if (response.stop_reason === 'refusal' || !response.parsed_output) throw new Error('AI could not sort this reply')
  return response.parsed_output
}

export function describeAiError(err: unknown) {
  if (err instanceof Anthropic.AuthenticationError) return 'ANTHROPIC_API_KEY is invalid'
  if (err instanceof Anthropic.RateLimitError) return 'AI rate limit reached; will retry on the next run'
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the AI service'
  if (err instanceof Anthropic.APIError) return `AI error ${err.status ?? ''}: ${err.message}`.slice(0, 200)
  return (err as Error)?.message?.slice(0, 200) || 'AI review failed'
}
