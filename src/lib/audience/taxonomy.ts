// Shared vocabulary of the audience system. Browser-safe (no server imports).

export const PERSONAS = {
  FOUNDER:        { label: 'Founder / SaaS founder', tier: 'HIGH' },
  AGENCY:         { label: 'AI / automation agency', tier: 'HIGH' },
  CONSULTANT:     { label: 'Automation consultant',  tier: 'HIGH' },
  BUSINESS_OWNER: { label: 'Business owner',         tier: 'HIGH' },
  DEVELOPER:      { label: 'AI developer',           tier: 'HIGH' },
  FREELANCER:     { label: 'Freelancer',             tier: 'MEDIUM' },
  TECH_PRO:       { label: 'Technical professional', tier: 'MEDIUM' },
  ENTHUSIAST:     { label: 'AI enthusiast',          tier: 'MEDIUM' },
} as const
export type Persona = keyof typeof PERSONAS

export const INTERESTS = {
  AI_RECEPTIONIST: {
    label: 'AI Receptionist',
    useCase: 'an AI receptionist that answers every call, handles questions and books appointments',
    short: 'an AI receptionist',
    examples: 'voice AI, phone answering, appointment booking',
  },
  AI_SALES: {
    label: 'AI Sales',
    useCase: 'an AI sales agent that qualifies leads, follows up and books calls',
    short: 'an AI sales agent',
    examples: 'lead qualification, outreach, follow-ups',
  },
  AI_DEVELOPMENT: {
    label: 'AI Development',
    useCase: 'custom AI agents with your own prompts, tools and integrations',
    short: 'custom AI agents',
    examples: 'LLM apps, agents, tool calling',
  },
  AI_AUTOMATION: {
    label: 'AI Automation',
    useCase: 'AI workflows that automate the repetitive parts of the business',
    short: 'AI workflows',
    examples: 'workflow automation, no-code, integrations',
  },
  GENERAL_AI: {
    label: 'General AI',
    useCase: 'an AI agent built around your own business',
    short: 'your own AI agent',
    examples: 'AI tools and agents',
  },
} as const
export type Interest = keyof typeof INTERESTS

/** The five PRD campaigns. Persona decides where a prospect goes. */
export const AUDIENCE_CAMPAIGNS = [
  { key: 'founders',    name: 'AI Builder — Founders',               personas: ['FOUNDER', 'BUSINESS_OWNER'], sequence: 'ai_builder_founders' },
  { key: 'developers',  name: 'AI Builder — Developers',             personas: ['DEVELOPER', 'TECH_PRO'],     sequence: 'ai_builder_developers' },
  { key: 'agencies',    name: 'AI Builder — AI Agencies',            personas: ['AGENCY'],                    sequence: 'ai_builder_agencies' },
  { key: 'consultants', name: 'AI Builder — Automation Consultants', personas: ['CONSULTANT', 'FREELANCER'],  sequence: 'ai_builder_consultants' },
  { key: 'enthusiasts', name: 'AI Builder — AI Enthusiasts',         personas: ['ENTHUSIAST'],                sequence: 'ai_builder_enthusiasts' },
] as const

/** Which AI Builder sequence a persona gets */
export function sequenceForPersona(persona?: string | null) {
  return (AUDIENCE_CAMPAIGNS.find((c) => (c.personas as readonly string[]).includes(persona || '')) || AUDIENCE_CAMPAIGNS[4]).sequence
}

export const RELEVANCE = ['HIGH', 'MEDIUM', 'LOW', 'SPAM'] as const
export type Relevance = (typeof RELEVANCE)[number]

export const EMAIL_STATUSES = ['VERIFIED', 'RISKY', 'UNKNOWN', 'INVALID'] as const
export type EmailStatus = (typeof EMAIL_STATUSES)[number]

export const PROSPECT_STATUSES = {
  NEW:              'New',
  RESEARCHING:      'Researching',
  PROFILE_FOUND:    'Profile found',
  EMAIL_FOUND:      'Email found',
  EMAIL_VERIFIED:   'Email verified',
  READY_TO_CONTACT: 'Ready to contact',
  NO_CONTACT:       'No contact found',
  IN_CAMPAIGN:      'In campaign',
  INVALID_EMAIL:    'Invalid email',
  DO_NOT_CONTACT:   'Do not contact',
} as const
export type ProspectStatus = keyof typeof PROSPECT_STATUSES

/** A prospect's outreach status once it is a CRM lead, in the PRD's vocabulary */
export function outreachStatus(leadStatus?: string | null) {
  const map: Record<string, string> = {
    FIRST_EMAIL_SENT: 'Email sent', FOLLOW_UP_1_SENT: 'Follow-up 1', FOLLOW_UP_2_SENT: 'Follow-up 2',
    FOLLOW_UP_3_SENT: 'Follow-up 3', REPLIED: 'Replied', INTERESTED: 'Interested', DEMO_SENT: 'Demo',
    MEETING_BOOKED: 'Meeting booked', WON: 'Won', NOT_INTERESTED: 'Not interested', LOST: 'Lost',
    INVALID_EMAIL: 'Invalid email', DO_NOT_CONTACT: 'Do not contact', UNSUBSCRIBED: 'Unsubscribed',
  }
  return leadStatus ? map[leadStatus] || 'Queued' : null
}

// ─── Countries ───────────────────────────────────────────────────────────────
// English is used for business in all of these. Anything else is still allowed when the
// comment itself is in English (YouTube's country field is often empty).

export const REGIONS = {
  AMERICAS:           'Americas',
  EUROPE:             'Europe',
  MIDDLE_EAST_AFRICA: 'Middle East & Africa',
  ASIA_PACIFIC:       'Asia-Pacific',
} as const
export type Region = keyof typeof REGIONS

export const COUNTRIES: Record<string, { name: string; region: Region; english: boolean }> = {
  US: { name: 'United States', region: 'AMERICAS', english: true },
  CA: { name: 'Canada', region: 'AMERICAS', english: true },
  JM: { name: 'Jamaica', region: 'AMERICAS', english: true },
  TT: { name: 'Trinidad and Tobago', region: 'AMERICAS', english: true },
  BS: { name: 'Bahamas', region: 'AMERICAS', english: true },
  BB: { name: 'Barbados', region: 'AMERICAS', english: true },
  BZ: { name: 'Belize', region: 'AMERICAS', english: true },
  GY: { name: 'Guyana', region: 'AMERICAS', english: true },
  PR: { name: 'Puerto Rico', region: 'AMERICAS', english: true },
  MX: { name: 'Mexico', region: 'AMERICAS', english: false },
  BR: { name: 'Brazil', region: 'AMERICAS', english: false },
  AR: { name: 'Argentina', region: 'AMERICAS', english: false },
  CO: { name: 'Colombia', region: 'AMERICAS', english: false },
  CL: { name: 'Chile', region: 'AMERICAS', english: false },
  GB: { name: 'United Kingdom', region: 'EUROPE', english: true },
  IE: { name: 'Ireland', region: 'EUROPE', english: true },
  MT: { name: 'Malta', region: 'EUROPE', english: true },
  NL: { name: 'Netherlands', region: 'EUROPE', english: false },
  DE: { name: 'Germany', region: 'EUROPE', english: false },
  FR: { name: 'France', region: 'EUROPE', english: false },
  ES: { name: 'Spain', region: 'EUROPE', english: false },
  IT: { name: 'Italy', region: 'EUROPE', english: false },
  PT: { name: 'Portugal', region: 'EUROPE', english: false },
  BE: { name: 'Belgium', region: 'EUROPE', english: false },
  SE: { name: 'Sweden', region: 'EUROPE', english: false },
  DK: { name: 'Denmark', region: 'EUROPE', english: false },
  NO: { name: 'Norway', region: 'EUROPE', english: false },
  FI: { name: 'Finland', region: 'EUROPE', english: false },
  PL: { name: 'Poland', region: 'EUROPE', english: false },
  CH: { name: 'Switzerland', region: 'EUROPE', english: false },
  AT: { name: 'Austria', region: 'EUROPE', english: false },
  CY: { name: 'Cyprus', region: 'EUROPE', english: true },
  AE: { name: 'United Arab Emirates', region: 'MIDDLE_EAST_AFRICA', english: true },
  SA: { name: 'Saudi Arabia', region: 'MIDDLE_EAST_AFRICA', english: false },
  QA: { name: 'Qatar', region: 'MIDDLE_EAST_AFRICA', english: true },
  IL: { name: 'Israel', region: 'MIDDLE_EAST_AFRICA', english: true },
  ZA: { name: 'South Africa', region: 'MIDDLE_EAST_AFRICA', english: true },
  NG: { name: 'Nigeria', region: 'MIDDLE_EAST_AFRICA', english: true },
  KE: { name: 'Kenya', region: 'MIDDLE_EAST_AFRICA', english: true },
  GH: { name: 'Ghana', region: 'MIDDLE_EAST_AFRICA', english: true },
  UG: { name: 'Uganda', region: 'MIDDLE_EAST_AFRICA', english: true },
  TZ: { name: 'Tanzania', region: 'MIDDLE_EAST_AFRICA', english: true },
  RW: { name: 'Rwanda', region: 'MIDDLE_EAST_AFRICA', english: true },
  ZW: { name: 'Zimbabwe', region: 'MIDDLE_EAST_AFRICA', english: true },
  ZM: { name: 'Zambia', region: 'MIDDLE_EAST_AFRICA', english: true },
  EG: { name: 'Egypt', region: 'MIDDLE_EAST_AFRICA', english: false },
  IN: { name: 'India', region: 'ASIA_PACIFIC', english: true },
  PK: { name: 'Pakistan', region: 'ASIA_PACIFIC', english: true },
  BD: { name: 'Bangladesh', region: 'ASIA_PACIFIC', english: true },
  LK: { name: 'Sri Lanka', region: 'ASIA_PACIFIC', english: true },
  NP: { name: 'Nepal', region: 'ASIA_PACIFIC', english: true },
  SG: { name: 'Singapore', region: 'ASIA_PACIFIC', english: true },
  MY: { name: 'Malaysia', region: 'ASIA_PACIFIC', english: true },
  PH: { name: 'Philippines', region: 'ASIA_PACIFIC', english: true },
  HK: { name: 'Hong Kong', region: 'ASIA_PACIFIC', english: true },
  AU: { name: 'Australia', region: 'ASIA_PACIFIC', english: true },
  NZ: { name: 'New Zealand', region: 'ASIA_PACIFIC', english: true },
  ID: { name: 'Indonesia', region: 'ASIA_PACIFIC', english: false },
  VN: { name: 'Vietnam', region: 'ASIA_PACIFIC', english: false },
  TH: { name: 'Thailand', region: 'ASIA_PACIFIC', english: false },
  JP: { name: 'Japan', region: 'ASIA_PACIFIC', english: false },
  KR: { name: 'South Korea', region: 'ASIA_PACIFIC', english: false },
}

export const ENGLISH_COUNTRIES = Object.entries(COUNTRIES).filter(([, c]) => c.english).map(([code]) => code)

// Countries where unsolicited email to individuals needs consent or a conspicuously
// published business address (GDPR/PECR, CASL, Spam Act 2003, UEMA)
const EEA = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO']
export const CONSENT_SENSITIVE = new Set([...EEA, 'GB', 'CH', 'CA', 'AU', 'NZ'])

// ccTLD → country, used when the channel has no country but the person's website does
const TLD_COUNTRY: Record<string, string> = {
  'co.uk': 'GB', uk: 'GB', ie: 'IE', ca: 'CA', 'com.au': 'AU', au: 'AU', 'co.nz': 'NZ', nz: 'NZ',
  in: 'IN', 'co.in': 'IN', sg: 'SG', 'com.sg': 'SG', 'co.za': 'ZA', za: 'ZA', ng: 'NG', 'com.ng': 'NG',
  'co.ke': 'KE', ke: 'KE', ae: 'AE', ph: 'PH', 'com.ph': 'PH', my: 'MY', 'com.my': 'MY', pk: 'PK',
  de: 'DE', fr: 'FR', nl: 'NL', es: 'ES', it: 'IT', se: 'SE', dk: 'DK', no: 'NO', fi: 'FI', be: 'BE',
  ch: 'CH', at: 'AT', pl: 'PL', pt: 'PT', mt: 'MT', 'com.gh': 'GH', gh: 'GH', 'co.il': 'IL', hk: 'HK',
}

export function countryFromDomain(url?: string | null) {
  const host = (url || '').toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0]
  if (!host) return null
  const parts = host.split('.')
  const two = parts.slice(-2).join('.')
  return TLD_COUNTRY[two] || TLD_COUNTRY[parts[parts.length - 1]] || null
}

export function regionOf(country?: string | null): Region | null {
  return (country && COUNTRIES[country.toUpperCase()]?.region) || null
}

export function countryName(code?: string | null) {
  if (!code) return ''
  return COUNTRIES[code.toUpperCase()]?.name || code.toUpperCase()
}

// ─── Discovery presets ───────────────────────────────────────────────────────
// Searches that surface audiences who build things, not just watch AI news

export const SEARCH_PRESETS = [
  { label: 'AI agents (build)',   q: 'how to build AI agents', interest: 'AI_DEVELOPMENT' },
  { label: 'AI voice agent',      q: 'build AI voice agent receptionist', interest: 'AI_RECEPTIONIST' },
  { label: 'Vapi / Retell',       q: 'vapi retell voice agent tutorial', interest: 'AI_RECEPTIONIST' },
  { label: 'AI sales agent',      q: 'AI sales agent lead generation automation', interest: 'AI_SALES' },
  { label: 'AI appointment setter', q: 'AI appointment setter', interest: 'AI_SALES' },
  { label: 'n8n AI automation',   q: 'n8n AI agent automation', interest: 'AI_AUTOMATION' },
  { label: 'Make.com / Zapier AI', q: 'make.com zapier AI automation business', interest: 'AI_AUTOMATION' },
  { label: 'AI automation agency', q: 'AI automation agency AAA', interest: 'AI_AUTOMATION' },
  { label: 'No-code AI',          q: 'no code AI app builder', interest: 'AI_AUTOMATION' },
  { label: 'AI for small business', q: 'AI tools for small business owners', interest: 'GENERAL_AI' },
  { label: 'LLM app development', q: 'LLM app development RAG tutorial', interest: 'AI_DEVELOPMENT' },
  { label: 'AI customer support', q: 'AI customer support agent chatbot', interest: 'AI_RECEPTIONIST' },
] as const

export function interestLabel(k?: string | null) {
  return (k && INTERESTS[k as Interest]?.label) || '—'
}
export function personaLabel(k?: string | null) {
  return (k && PERSONAS[k as Persona]?.label) || '—'
}
