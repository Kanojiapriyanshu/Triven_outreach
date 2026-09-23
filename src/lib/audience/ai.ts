// Optional AI review of prospects the rules already shortlisted (never the whole firehose).
// Enabled when ANTHROPIC_API_KEY is set. Without it the rule-based verdicts stand.
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod/v4'

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
  })),
})
export type AiReview = z.infer<typeof Review>['results'][number]

const SYSTEM = `You review YouTube commenters for Triven, a company whose AI Builder lets people create their own AI agents and workflows (AI receptionists, AI sales agents, support agents, appointment agents, lead-qualification and follow-up agents) without building everything from scratch.

For each person you get their public YouTube comments (with the video they commented on) and, when available, their channel bio. Judge how likely they are to want to build an AI agent or workflow for a real use case.

relevance:
- HIGH: founders, SaaS builders, AI/automation agency owners, automation consultants, business owners wanting AI in their business, developers building AI agents. The comment shows they build or want to build something concrete.
- MEDIUM: engaged enthusiasts, freelancers, technical professionals asking substantive questions.
- LOW: generic praise, off-topic, jokes, one-liners, pure news/opinion reactions, job-loss worries.
- SPAM: scams, self-promotion, bots, crypto/forex, "contact me on WhatsApp/Telegram".

persona: the single best fit, or null if the comments give no clue.
interest: the use case they care about most (AI_RECEPTIONIST = voice/phone/booking/support; AI_SALES = leads/outreach/follow-up/CRM; AI_AUTOMATION = workflows/no-code/n8n/Make/Zapier; AI_DEVELOPMENT = code/APIs/LLM apps/agent frameworks; GENERAL_AI otherwise).
topic: a short lowercase noun phrase (max 9 words) that completes "I saw your comment about ___", e.g. "building voice agents for dental clinics" or "automating lead follow-up with n8n". Describe what they talked about; never quote them; never mention YouTube or the video.
reason: max 20 words, plain English, why they are (or aren't) a good prospect. This is internal.
icebreaker: one sentence (max 25 words) a thoughtful peer would write in reply to the substance of their comment: agree, add a concrete insight, or answer their question. No flattery ("great comment"), no product pitch, no claims about Triven, no questions. Empty string for LOW or SPAM.

Return one result per input id, same ids. Comments may be in any English variant; treat spelling mistakes kindly.`

let client: Anthropic | null = null

export async function reviewProspects(people: Array<{ id: string; name: string; bio?: string | null; comments: Array<{ video: string; text: string }> }>): Promise<AiReview[]> {
  if (!people.length) return []
  client ||= new Anthropic()
  const input = people.map((p) => ({
    id: p.id,
    name: p.name,
    bio: (p.bio || '').slice(0, 500),
    comments: p.comments.slice(0, 4).map((c) => ({ video: c.video.slice(0, 120), text: c.text.slice(0, 700) })),
  }))

  const format = zodOutputFormat(Review)
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // Haiku 4.5 has no effort setting
    output_config: MODEL.startsWith('claude-haiku') ? { format } : { effort: 'low', format },
    system: SYSTEM,
    messages: [{ role: 'user', content: `Review these ${input.length} people:\n\n${JSON.stringify(input)}` }],
  })

  if (response.stop_reason === 'refusal') throw new Error('The AI declined this batch; rule-based verdicts kept')
  if (response.stop_reason === 'max_tokens') throw new Error('AI response was cut off; try a smaller batch')
  const parsed = response.parsed_output
  if (!parsed) throw new Error('AI returned no usable result')
  const ids = new Set(people.map((p) => p.id))
  return parsed.results.filter((r) => ids.has(r.id))
}

export function describeAiError(err: unknown) {
  if (err instanceof Anthropic.AuthenticationError) return 'ANTHROPIC_API_KEY is invalid'
  if (err instanceof Anthropic.RateLimitError) return 'AI rate limit reached; will retry on the next run'
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the AI service'
  if (err instanceof Anthropic.APIError) return `AI error ${err.status ?? ''}: ${err.message}`.slice(0, 200)
  return (err as Error)?.message?.slice(0, 200) || 'AI review failed'
}
