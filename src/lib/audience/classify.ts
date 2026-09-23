// Rule-based audience filtering. Free, instant and explainable; the optional AI pass
// (ai.ts) refines the candidates it produces. Pure functions, browser-safe.
import type { Interest, Persona, Relevance } from './taxonomy'

export interface CommentVerdict {
  relevance: Relevance
  score: number
  persona: Persona | null
  interest: Interest | null
  topic: string | null
  signals: string[]
  language: 'en' | 'other'
}

// ─── Language ────────────────────────────────────────────────────────────────

const EN_WORDS = new Set(('the a an and or but is are was were be been to of in on for with this that it its i you we they my your our ' +
  'how what can do does not no yes have has will would could should just so if from at about like love great thanks thank video ' +
  'build building make using use want need get know me him her them there here all any some more very really also than').split(' '))

export function detectLanguage(text: string): 'en' | 'other' {
  const letters = text.replace(/[^\p{L}]/gu, '')
  if (!letters.length) return 'other'
  const latin = letters.replace(/[^a-zA-Z]/g, '').length / letters.length
  if (latin < 0.85) return 'other'
  const words = text.toLowerCase().match(/[a-z']+/g) || []
  if (words.length <= 3) return 'en' // too short to tell; latin script is enough
  const hits = words.filter((w) => EN_WORDS.has(w)).length
  return hits / words.length >= 0.12 ? 'en' : 'other'
}

// ─── Patterns ────────────────────────────────────────────────────────────────

const SPAM = [
  /\b(t\.me|telegram|whats\s?app|wa\.me|signal app)\b/i,
  /\b(crypto|bitcoin|btc|forex|binary options?|trading signals?|expert trader|investment (manager|advisor|coach)|financial advis[eo]r|portfolio grew|passive income|recovered my|hacker|spell ?caster)\b/i,
  /\b(sub4sub|sub ?for ?sub|check (out )?my channel|subscribe to my|visit my channel|follow me on)\b/i,
  /(\+?\d[\d\s().-]{9,}\d)/, // phone numbers in comments are nearly always scams
  /\b(onlyfans|dating|hot singles|18\+)\b/i,
  /(.)\1{7,}/,                 // "!!!!!!!!!" / "hahahahahaha"
]
const GENERIC = /^(great|nice|awesome|amazing|cool|good|thanks?|thank you|thx|wow|first|love (it|this)|well done|brilliant|excellent|super|fantastic|perfect|informative|helpful|very helpful|so helpful|this is (great|amazing|gold|awesome)|great (video|content|stuff|job|work|explanation|tutorial)|keep (it )?up|subscribed|🔥+|👍+|❤️+)[\s!.❤️🔥👍🙏💯😊😍]*(bro|man|sir|mate|brother|dude|guys?)?[\s!.❤️🔥👍🙏💯]*$/i

const SIG: Array<{ key: string; re: RegExp; w: number }> = [
  { key: 'building_now',  w: 25, re: /\b(i('?m| am) (currently )?(building|working on|creating|developing|making|launching|trying to build)|we('?re| are) (building|launching|developing|working on)|i (just )?(built|made|created|launched|shipped)|we (just )?(built|launched|shipped)|my (project|app|saas|startup|agent|bot|workflow|mvp|tool|product|backend|server|platform|stack|system|codebase|website|site|client project))\b/i },
  { key: 'business',      w: 25, re: /\b(my (own )?(business|company|clinic|practice|shop|store|restaurant|firm|salon|agency|team|clients?|customers?|employees|staff|brand|ecommerce|e-commerce)|our (business|company|clients?|customers?|team|startup|firm|agency|product|sales team)|i (own|run|manage) (a|an|my|the)|small business owner|business owner)\b/i },
  { key: 'agency',        w: 25, re: /\b(agency|agencies|my clients|for (my |our )?clients|client work|white.?label|resell(ing)?|AAA|automation agency|sell (this|these|it) to)\b/i },
  { key: 'founder',       w: 25, re: /\b(founder|co-?founder|ceo|my startup|our startup|saas|bootstrapp\w*|indie hacker|solopreneur|entrepreneur)\b/i },
  { key: 'consultant',    w: 18, re: /\b(consultant|consulting|i help (businesses|companies|clients))\b/i },
  { key: 'freelance',     w: 12, re: /\b(freelanc\w*|upwork|fiverr|side hustle|gig)\b/i },
  { key: 'developer',     w: 15, re: /\b(api|apis|python|javascript|typescript|node\.?js|next\.?js|langchain|langgraph|llama ?index|crewai|autogen|openai api|claude api|anthropic|rag|vector (db|database|store)|embeddings?|fine.?tun\w*|webhooks?|docker|deploy\w*|github|sdk|function calling|tool calling|mcp|prompt engineering|my code|backend|frontend|supabase|firebase)\b/i },
  { key: 'build_intent',  w: 15, re: /\b(how (do|can|would|should) (i|we|you|one)|is (it|there a way|this) possible|can (it|this|you|i|we)|does (it|this) (work|support|integrate|handle)|could you (make|do|show|explain)|tutorial (on|for)|step.by.step|what('?s| is) the best (way|tool)|which (tool|platform|model) (should|would|is))\b/i },
  { key: 'money',         w: 10, re: /\b(pricing|charge|price|cost|revenue|sell|monetiz\w*|paying|per month|mrr|roi|\$\d+)\b/i },
  { key: 'pain',          w: 8,  re: /\b(struggl\w*|stuck|can'?t figure|doesn'?t work|keeps? (failing|breaking|crashing)|fail(s|ing|ed)|errors?|bugs?|broken|hard to|difficult|too (complex|complicated|expensive)|frustrat\w*|hallucinat\w*|latency|too slow)\b/i },
  { key: 'tech_job',      w: 8,  re: /\b(at work|my (boss|manager|employer|job|role)|(software|data|ml|ai|it) (engineer|analyst|team)|devops|product manager)\b/i },
]

const INTEREST_RE: Record<Interest, RegExp> = {
  AI_RECEPTIONIST: /\b(receptionist|voice (agents?|ai|bots?|assistants?)|phone (calls?|agents?|system)|inbound calls?|outbound calls?|call (center|centre)s?|answer(ing)? (the )?(phone|calls)|vapi|retell|bland(\.ai)?|twilio|synthflow|elevenlabs|appointments?|bookings?|missed calls|customer (support|service)|support (agent|bot)|front desk|ivr)\b/i,
  AI_SALES: /\b(sales|leads?|lead (gen|generation|qualification)|cold (emails?|calls?|outreach)|outreach|prospect\w*|sdr|appointment setter|crm|follow.?ups?|close deals|pipeline|gohighlevel|ghl|hubspot|closer|conversion)\b/i,
  AI_AUTOMATION: /\b(n8n|make\.com|zapier|workflows?|automat\w*|no.?code|low.?code|integrations?|airtable|google sheets|notion|flowise|relevance ai|voiceflow|botpress|scrap\w*)\b/i,
  AI_DEVELOPMENT: /\b(api|llms?|gpt|langchain|langgraph|crewai|autogen|agent frameworks?|rag|fine.?tun\w*|python|coding|code|sdk|mcp|open.?source|local models?|ollama)\b/i,
  GENERAL_AI: /\b(ai|agents?|chatgpt|claude|gemini)\b/i,
}

const INDUSTRY_RE = /\b(dental|dentists?|clinics?|medical|healthcare|real estate|realtors?|restaurants?|salons?|spas?|hvac|plumb\w*|roofing|law (firms?)?|lawyers?|insurance|e-?commerce|shopify|coaching|coaches|gyms?|fitness|hotels?|hospitality|car dealers?\w*|auto (shops?|repair)|mortgage|accounting|recruit\w*|construction|home services|property management)\b/i

const TOOL_RE = /\b(n8n|make\.com|zapier|vapi|retell|bland(?:\.ai)?|voiceflow|botpress|flowise|langchain|langgraph|crewai|autogen|gohighlevel|ghl|twilio|elevenlabs|synthflow|relevance ai|airtable|supabase)\b/i

const TOOL_NAMES: Record<string, string> = {
  n8n: 'n8n', 'make.com': 'Make', zapier: 'Zapier', vapi: 'Vapi', retell: 'Retell', bland: 'Bland', 'bland.ai': 'Bland',
  voiceflow: 'Voiceflow', botpress: 'Botpress', flowise: 'Flowise', langchain: 'LangChain', langgraph: 'LangGraph',
  crewai: 'CrewAI', autogen: 'AutoGen', gohighlevel: 'GoHighLevel', ghl: 'GoHighLevel', twilio: 'Twilio',
  elevenlabs: 'ElevenLabs', synthflow: 'Synthflow', 'relevance ai': 'Relevance AI', airtable: 'Airtable', supabase: 'Supabase',
}

function industryPhrase(text: string) {
  const m = text.match(INDUSTRY_RE)?.[1]?.toLowerCase()
  if (!m) return ''
  const map: Record<string, string> = {
    dental: 'dental practices', dentist: 'dental practices', dentists: 'dental practices', clinic: 'clinics', clinics: 'clinics',
    medical: 'medical practices', healthcare: 'healthcare', 'real estate': 'real estate', realtor: 'real estate', realtors: 'real estate',
    restaurant: 'restaurants', restaurants: 'restaurants', salon: 'salons', salons: 'salons', spa: 'spas', spas: 'spas', hvac: 'HVAC companies',
    roofing: 'roofing companies', lawyer: 'law firms', lawyers: 'law firms', insurance: 'insurance', ecommerce: 'e-commerce',
    'e-commerce': 'e-commerce', shopify: 'Shopify stores', coaching: 'coaching businesses', coaches: 'coaches', gym: 'gyms', gyms: 'gyms',
    fitness: 'fitness businesses', hotel: 'hotels', hotels: 'hotels', hospitality: 'hospitality', mortgage: 'mortgage brokers',
    accounting: 'accounting firms', construction: 'construction companies', 'home services': 'home services', 'property management': 'property management',
  }
  if (m.startsWith('plumb')) return 'plumbing businesses'
  if (m.startsWith('recruit')) return 'recruiting'
  if (m.startsWith('law')) return 'law firms'
  if (m.startsWith('car dealer')) return 'car dealerships'
  if (m.startsWith('auto')) return 'auto shops'
  return map[m] || m
}

/** "about ___": a short noun phrase used in the email ("I saw your comment … about ___") */
export function topicPhrase(text: string, interest: Interest | null, building: boolean) {
  const tool = text.match(TOOL_RE)?.[1]?.toLowerCase()
  const toolName = tool ? TOOL_NAMES[tool] || tool : ''
  const ind = industryPhrase(text)
  const forInd = ind ? ` for ${ind}` : ''
  switch (interest) {
    case 'AI_RECEPTIONIST':
      return `${building ? 'building ' : ''}AI voice agents${forInd}${!ind && toolName ? ` with ${toolName}` : ''}`
    case 'AI_SALES':
      return /follow.?up/i.test(text) ? `automating sales follow-ups${forInd}` : `${building ? 'building ' : 'using '}AI for sales and lead generation${forInd}`
    case 'AI_AUTOMATION':
      return toolName ? `automating workflows with ${toolName}${forInd}` : `AI automation${forInd}`
    case 'AI_DEVELOPMENT':
      return `building AI agents${toolName ? ` with ${toolName}` : ''}${forInd}`
    default:
      return building ? `building with AI${forInd}` : `using AI${forInd || ' in your work'}`
  }
}

function pickInterest(text: string, fallback?: string | null): Interest | null {
  const scores = (Object.keys(INTEREST_RE) as Interest[])
    .filter((k) => k !== 'GENERAL_AI')
    .map((k) => ({ k, n: (text.match(new RegExp(INTEREST_RE[k].source, 'gi')) || []).length }))
    .sort((a, b) => b.n - a.n)
  if (scores[0].n > 0) return scores[0].k
  if (fallback && fallback !== 'GENERAL_AI') return fallback as Interest
  return INTEREST_RE.GENERAL_AI.test(text) ? 'GENERAL_AI' : ((fallback as Interest) || null)
}

function pickPersona(sig: Set<string>): Persona | null {
  if (sig.has('agency')) return 'AGENCY'
  if (sig.has('founder')) return 'FOUNDER'
  if (sig.has('business')) return 'BUSINESS_OWNER'
  if (sig.has('consultant')) return 'CONSULTANT'
  if (sig.has('freelance')) return 'FREELANCER'
  if (sig.has('developer')) return 'DEVELOPER'
  if (sig.has('tech_job')) return 'TECH_PRO'
  if (sig.has('build_intent') || sig.has('building_now')) return 'ENTHUSIAST'
  return null
}

export function relevanceFor(score: number): Relevance {
  return score >= 55 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW'
}

// ─── Person-level intent & identity ──────────────────────────────────────────
// A person is worth contacting when there's evidence they build or buy, not just that they watched.

const EVIDENCE: Record<string, string> = {
  business: 'Talks about their own business',
  agency: 'Works for clients / runs an agency',
  founder: 'Founder or building a startup',
  building_now: 'Already building something',
  consultant: 'Consultant',
  freelance: 'Freelancer',
  developer: 'Writes code (APIs, frameworks)',
  build_intent: 'Asks how to implement it',
  money: 'Talks pricing / revenue / clients paying',
  pain: 'Has a concrete problem to solve',
  tech_job: 'Works in tech',
}
const STRONG = ['business', 'agency', 'founder', 'building_now', 'consultant']
const BIO_STRONG = ['FOUNDER', 'AGENCY', 'CONSULTANT', 'BUSINESS_OWNER', 'DEVELOPER']

export interface IntentInput {
  comments: Array<{ score: number; signals: string[]; relevance: string; channel: string; video: string }>
  bioPersona?: string | null
  bioTitle?: string | null
  ownChannelAi?: boolean
  ownChannelSummary?: string | null
  hasWebsite?: boolean
}

/** 0-100 intent score, relevance and the evidence behind it */
export function computeIntent(i: IntentInput): { intent: number; relevance: Relevance; evidence: string[] } {
  const real = i.comments.filter((c) => c.relevance !== 'SPAM')
  if (!real.length) return { intent: 0, relevance: 'SPAM', evidence: ['Only spam comments'] }
  const best = [...real].sort((a, b) => b.score - a.score)[0]
  const signals = new Set(real.flatMap((c) => c.signals))
  const videos = new Set(real.map((c) => c.video)).size
  const channels = new Set(real.map((c) => c.channel)).size

  const strongComment = STRONG.some((s) => signals.has(s)) || (signals.has('developer') && (signals.has('build_intent') || signals.has('pain')))
  const strongBio = !!i.bioPersona && BIO_STRONG.includes(i.bioPersona)
  let intent = Math.min(45, Math.round(best.score * 0.55))
  if (strongComment) intent += 15
  if (['money', 'build_intent', 'pain'].some((s) => signals.has(s))) intent += 8
  intent += Math.min(12, (real.length - 1) * 6)
  if (channels >= 2) intent += 8
  if (i.ownChannelAi) intent += 15
  if (strongBio) intent += 10
  if (i.hasWebsite) intent += 5
  intent = Math.max(0, Math.min(100, intent))

  const evidence = [...signals].filter((s) => EVIDENCE[s]).sort((a, b) => Number(STRONG.includes(b)) - Number(STRONG.includes(a))).map((s) => EVIDENCE[s])
  if (real.length > 1) evidence.push(`${real.length} comments on ${videos} video${videos === 1 ? '' : 's'}${channels > 1 ? ` across ${channels} channels` : ''}`)
  if (i.ownChannelAi) evidence.push(`Own channel: ${i.ownChannelSummary || 'publishes AI/automation videos'}`)
  if (i.bioPersona) evidence.push(`Bio: ${i.bioTitle || i.bioPersona.toLowerCase().replace('_', ' ')}`)

  const strong = strongComment || strongBio || !!i.ownChannelAi
  // Calibrated on real comment data: people with a strong signal cluster at 52-59, so 60 missed them
  const relevance: Relevance = intent >= 52 && strong ? 'HIGH' : intent >= 35 ? 'MEDIUM' : 'LOW'
  return { intent, relevance, evidence }
}

/** 0-100: how sure we are who this person is (and so whose inbox we'd write to) */
export function computeIdentity(p: { website?: string | null; linkedIn?: string | null; company?: string | null; firstName?: string | null; lastName?: string | null; videoCount?: number }) {
  let s = 0
  if (p.website) s += 40
  if (p.linkedIn) s += 20
  if (p.company) s += 15
  if (p.firstName && p.lastName) s += 15
  else if (p.firstName) s += 5
  if ((p.videoCount || 0) > 0) s += 10
  return Math.min(100, s)
}

const AI_CONTENT = /\b(ai|a\.i\.|agents?|automat\w*|n8n|make\.com|zapier|chatgpt|gpt|llm|claude|gemini|no.?code|voice ?(ai|agent)|chatbot|workflow|saas|langchain|vapi|retell)\b/i

/** Is their own channel about AI/automation? From their latest upload titles. */
export function ownChannelProfile(titles: string[]) {
  if (!titles.length) return { ai: false, summary: null as string | null }
  const ai = titles.filter((t) => AI_CONTENT.test(t)).length
  const toolRe = new RegExp(TOOL_RE.source, 'gi')
  const tools = [...new Set(titles.flatMap((t) => [...t.matchAll(toolRe)].map((m) => TOOL_NAMES[m[1].toLowerCase()] || m[1])))].slice(0, 3)
  const isAi = ai >= Math.max(2, Math.ceil(titles.length * 0.4))
  const summary = isAi
    ? `${ai} of their last ${titles.length} videos are about AI/automation${tools.length ? ` (${tools.join(', ')})` : ''}`
    : `${titles.length} recent videos, mostly not about AI`
  return { ai: isAi, summary }
}

/** Score one comment. `videoInterest` is the topic of the video it was left on. */
export function classifyComment(text: string, ctx: { likeCount?: number; videoInterest?: string | null; authorName?: string } = {}): CommentVerdict {
  const t = text.trim()
  const language = detectLanguage(t)
  const none = { persona: null, interest: null, topic: null }

  if (SPAM.some((re) => re.test(t)) || /telegram|whats\s?app|\+\d{6,}/i.test(ctx.authorName || '')) {
    return { relevance: 'SPAM', score: 0, signals: ['spam'], language, ...none }
  }
  const words = t.split(/\s+/).filter(Boolean)
  if (GENERIC.test(t) || words.length < 4) {
    return { relevance: 'LOW', score: 3, signals: ['generic'], language, ...none }
  }

  const signals = new Set<string>()
  let score = 5
  for (const s of SIG) {
    if (s.re.test(t)) {
      signals.add(s.key)
      score += s.w
    }
  }
  if (t.length >= 80) score += 8
  if (t.length >= 200) score += 7
  if (t.includes('?')) score += 5
  score += Math.min(10, Math.floor((ctx.likeCount || 0) / 3))
  // A comment that only praises the creator is an audience member, not a builder
  if (!signals.size && /\b(thank|thanks|love|great|amazing|awesome)\b/i.test(t) && t.length < 120) score -= 5

  const interest = pickInterest(t, ctx.videoInterest)
  const persona = pickPersona(signals)
  if (language === 'other') {
    signals.add('non_english')
    score = Math.min(score, 15)
  }
  score = Math.max(0, Math.min(100, score))
  const building = signals.has('building_now') || signals.has('build_intent') || signals.has('business') || signals.has('agency')
  return {
    relevance: relevanceFor(score),
    score,
    persona,
    interest,
    topic: score >= 30 ? topicPhrase(t, interest, building) : null,
    signals: [...signals],
    language,
  }
}

// ─── Videos ──────────────────────────────────────────────────────────────────

const VIDEO_GOOD = /\b(how to|tutorial|step.by.step|build|building|create|make|agents?|automat\w*|n8n|make\.com|zapier|voice|receptionist|sales|lead|workflow|no.?code|business|agency|saas|clients?|full course|beginners?)\b/gi
const VIDEO_BAD = /\b(news|drama|reacts?|reaction|meme|funny|music|song|lyrics|gaming|trailer|shorts|podcast ep|stock|crypto|forex|job loss|scary|doom)\b/i

/** How well a video's audience fits Triven (0-100), with reasons */
export function scoreVideo(v: { title: string; description?: string | null; viewCount: number; commentCount: number; likeCount: number; publishedAt?: Date | null; durationSeconds: number }) {
  const reasons: string[] = []
  let score = 0
  const title = `${v.title} ${(v.description || '').slice(0, 400)}`
  const good = new Set((title.match(VIDEO_GOOD) || []).map((w) => w.toLowerCase())).size
  score += Math.min(35, good * 7)
  if (good) reasons.push(`${good} builder topic${good === 1 ? '' : 's'} in title/description`)
  if (VIDEO_BAD.test(v.title)) { score -= 20; reasons.push('entertainment/news angle') }

  // Discussion volume, with diminishing returns
  const c = v.commentCount
  const commentPts = c >= 2000 ? 25 : c >= 800 ? 21 : c >= 300 ? 17 : c >= 100 ? 12 : c >= 30 ? 6 : 0
  score += commentPts
  reasons.push(`${c.toLocaleString('en-US')} comments`)

  // Comments per 1k views: a talkative audience asks questions
  const rate = v.viewCount ? (c / v.viewCount) * 1000 : 0
  if (rate >= 8) { score += 15; reasons.push('very talkative audience') }
  else if (rate >= 4) { score += 10; reasons.push('talkative audience') }
  else if (rate >= 2) score += 5

  const ageDays = v.publishedAt ? (Date.now() - v.publishedAt.getTime()) / 86_400_000 : 999
  if (ageDays <= 90) { score += 15; reasons.push('recent') }
  else if (ageDays <= 365) score += 8
  else if (ageDays > 730) { score -= 5; reasons.push('older than 2 years') }

  if (v.durationSeconds >= 480) { score += 10; reasons.push('long-form') }
  else if (v.durationSeconds > 0 && v.durationSeconds <= 60) { score -= 15; reasons.push('Short: drive-by comments') }

  const interest = pickInterest(title, null)
  return { score: Math.max(0, Math.min(100, score)), reasons, interest }
}

// ─── People ──────────────────────────────────────────────────────────────────

const NOT_NAME = /^(the|ai|tech|official|tv|channel|studio|media|gaming|labs?|solutions?|agency|digital|crypto|bot|automation|automations|academy|hub|world|daily|news|pro|guru|master|king|queen|mr|mrs|ms|dr|real|its|i|am|youtube|music|productions?|group|inc|llc|ltd|company|team|official|creator|creators|dev|devs|code|coding|online|global|marketing|ventures?|capital|systems?)$/i

/**
 * YouTube gives handle-only accounts an auto suffix: "@BrandonWu-z5i", "@-RamkumarP-ds1zf".
 * Strip it (only when it contains a digit, so real hyphenated names survive).
 */
export function cleanHandle(h: string) {
  return h.trim().replace(/^@/, '').replace(/^-+/, '').replace(/-(?=[a-z0-9]{3,6}$)(?=.*\d)[a-z0-9]{3,6}$/i, '')
}

/** A first/last name only when the display name clearly is one */
export function parseName(displayName: string): { firstName?: string; lastName?: string } {
  let s = cleanHandle(displayName).replace(/[-_.]?\d+$/, '')
  // "@JohnSmith" → "John Smith", "@BrandonWu" → "Brandon Wu"
  if (!/\s/.test(s) && /^[A-Z][a-z]{2,11}[A-Z][a-z]{1,14}$/.test(s)) s = s.replace(/([a-z])([A-Z])/, '$1 $2')
  if (/[\d_@]/.test(s)) return {}
  const parts = s.split(/\s+/).filter(Boolean)
  if (!parts.length || parts.length > 3) return {}
  const ok = (w: string) => /^[A-Z][a-z'’-]{1,15}$/.test(w) && !NOT_NAME.test(w)
  if (!parts.every(ok)) {
    // "john smith" (all lowercase) is still a name
    if (parts.length >= 2 && parts.every((w) => /^[a-z]{2,15}$/.test(w) && !NOT_NAME.test(w))) {
      const cap = (w: string) => w[0].toUpperCase() + w.slice(1)
      return { firstName: cap(parts[0]), lastName: cap(parts[parts.length - 1]) }
    }
    return {}
  }
  if (parts.length === 1) return parts[0].length >= 3 ? { firstName: parts[0] } : {}
  return { firstName: parts[0], lastName: parts[parts.length - 1] }
}

/** Title / company / persona hints from a bio ("Founder @ Acme AI | automation for clinics") */
export function profileHints(bio: string) {
  const text = bio.replace(/\s+/g, ' ')
  const roleRe = /\b(co-?founder|founder|ceo|cto|coo|owner|managing director|director|head of [a-z ]{3,25}|(?:ai|ml|software|automation|prompt|full.?stack|backend|data) (?:engineer|developer)|developer|consultant|freelancer|agency owner)\b(?:\s*(?:of|at|@|,|-|–|\|)\s*([A-Z][\w&.'’ -]{1,40}?))?(?=[.,|•\n]|\s{2}|$| and | &| who)/i
  const m = text.match(roleRe)
  const jobTitle = m ? m[1].replace(/\b\w/g, (c) => c.toUpperCase()).replace(/Ceo|Cto|Coo/g, (x) => x.toUpperCase()) : undefined
  const company = m?.[2]?.trim()
  const sig = new Set<string>()
  for (const s of SIG) if (s.re.test(text)) sig.add(s.key)
  return { jobTitle, company, persona: pickPersona(sig), signals: [...sig] }
}
