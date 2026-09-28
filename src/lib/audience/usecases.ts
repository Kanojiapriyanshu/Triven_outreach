// What people want to build, and what Triven may say about building it. Browser-safe.
// The capability sheet limits every generated claim: nothing outside it is ever written
// into a "Why Triven" line or an email.

export const USE_CASES = {
  AI_RECEPTIONIST:       { label: 'AI receptionist',          short: 'an AI receptionist',            re: /\b(receptionist|front desk|answer(ing)? (the )?(phone|calls)|missed calls|inbound calls|call (handling|answering))\b/i },
  VOICE_AGENT:           { label: 'Voice agent',              short: 'a voice agent',                 re: /\b(voice (agents?|ai|bots?|assistants?)|phone (agents?|bots?)|outbound calls?|cold call\w*|vapi|retell|bland(\.ai)?|synthflow|elevenlabs|twilio|ivr|latency)\b/i },
  AI_SALES_AGENT:        { label: 'AI sales agent',           short: 'an AI sales agent',             re: /\b(sales (agents?|reps?|team|calls?)|sdr|closers?|outreach|cold (emails?|outreach)|close deals|sales pipeline)\b/i },
  LEAD_QUALIFICATION:    { label: 'Lead qualification',       short: 'a lead-qualification agent',    re: /\b(qualif(y|ying|ication)|lead (gen|generation)|inbound leads|speed to lead|new leads|lead follow.?up)\b/i },
  CUSTOMER_SUPPORT:      { label: 'Customer support',         short: 'a customer-support agent',      re: /\b(customer (support|service)|support (agents?|bots?|tickets?)|help ?desk|faqs?|chat ?bots?|tickets?)\b/i },
  APPOINTMENT_BOOKING:   { label: 'Appointment booking',      short: 'an appointment-booking agent',  re: /\b(book(ing)? (appointments?|calls?|meetings?)|appointments?|calendars?|cal\.com|calendly|scheduling|no.?shows?|reminders?)\b/i },
  INTERNAL_KNOWLEDGE:    { label: 'Internal knowledge',       short: 'an internal knowledge agent',   re: /\b(knowledge base|internal (docs|documents|wiki|tools?)|rag|our (docs|documents|sops?)|company data|chat with (docs|pdfs?))\b/i },
  MARKETING_AUTOMATION:  { label: 'Marketing automation',     short: 'a marketing automation agent',  re: /\b(marketing|content (creation|generation)|social media|seo|ads?|newsletters?|email campaigns?|linkedin posts?)\b/i },
  ONBOARDING:            { label: 'Customer onboarding',      short: 'an onboarding agent',           re: /\b(onboard(ing)?|new (clients?|customers?) setup|intake (forms?|process))\b/i },
  OPERATIONS_AUTOMATION: { label: 'Operations automation',    short: 'an operations workflow',        re: /\b(invoices?|invoicing|back.?office|data entry|operations|reporting|spreadsheets?|google sheets|crm updates?|n8n|make\.com|zapier|workflows?)\b/i },
  CUSTOM_WORKFLOW:       { label: 'Custom AI workflow',       short: 'a custom AI agent',             re: /\b(agents?|agentic|multi.?agent|langchain|langgraph|crewai|autogen|mcp|tool calling|function calling)\b/i },
  UNKNOWN:               { label: 'Not clear yet',            short: 'an AI agent',                   re: /$^/ },
} as const
export type UseCase = keyof typeof USE_CASES

export const USE_CASE_KEYS = Object.keys(USE_CASES) as UseCase[]

export function useCaseLabel(k?: string | null) {
  return (k && USE_CASES[k as UseCase]?.label) || '—'
}

export const FOR_WHOM = { SELF: 'Their own business', CLIENTS: 'For clients', EMPLOYER: 'At their job', UNKNOWN: 'Not clear' } as const
export const BUILD_STAGES = { EXPLORING: 'Exploring', BUILDING: 'Building', SHIPPED: 'Shipped', SELLING: 'Selling to clients' } as const

/** Legacy interest category → closest use case (for people collected before use cases existed) */
export const INTEREST_TO_USE_CASE: Record<string, UseCase> = {
  AI_RECEPTIONIST: 'AI_RECEPTIONIST', AI_SALES: 'AI_SALES_AGENT', AI_AUTOMATION: 'OPERATIONS_AUTOMATION', AI_DEVELOPMENT: 'CUSTOM_WORKFLOW', GENERAL_AI: 'UNKNOWN',
}

// ─── Capability sheet ────────────────────────────────────────────────────────

export interface CapabilitySheet {
  /** Use cases Triven AI Builder supports today (others lower Fit) */
  supported: UseCase[]
  /** One line per use case: what Triven does for it (used in "Why Triven"); empty = generic line */
  lines: Partial<Record<UseCase, string>>
  /** Blockers Triven removes (regex words): matching blockers raise Fit */
  removes: string
  /** Where each use case's ready-made template lives ({{templateOffer}}); empty = "reply and I'll send it" */
  templateLinks: Partial<Record<UseCase, string>>
  /** Product name used in generated lines */
  product: string
}

export const DEFAULT_CAPABILITIES: CapabilitySheet = {
  product: 'Triven AI Builder',
  supported: ['AI_RECEPTIONIST', 'VOICE_AGENT', 'AI_SALES_AGENT', 'LEAD_QUALIFICATION', 'CUSTOMER_SUPPORT', 'APPOINTMENT_BOOKING', 'OPERATIONS_AUTOMATION', 'CUSTOM_WORKFLOW'],
  lines: {
    AI_RECEPTIONIST: 'lets you describe the receptionist you need and runs it, so you design the conversation instead of the infrastructure',
    VOICE_AGENT: 'gives you the agent layer ready-made, so you focus on the conversation and the use case',
    AI_SALES_AGENT: 'lets you build the sales agent by describing it, including follow-ups and booking a call',
    LEAD_QUALIFICATION: 'lets you describe the qualification questions and what happens next, and runs the agent for you',
    CUSTOMER_SUPPORT: 'lets you build a support agent around your own documents and FAQs without coding it',
    APPOINTMENT_BOOKING: 'lets you build an agent that books appointments by describing how it should work',
    OPERATIONS_AUTOMATION: 'lets you turn the workflow into an agent you describe in plain English instead of stitching tools together',
    CUSTOM_WORKFLOW: 'handles the plumbing around an agent so the workflow you sketched can run without you building everything from scratch',
  },
  removes: 'latency|hosting|deploy|server|infrastructure|integrat|scal|maintain|coding|developer|technical|complex|complicated|time|stitch|glue|expensive|setup|set up',
  templateLinks: {},
}
