// "Receptionist buyers": business owners who say, under a YouTube video, that they miss calls.
// The opposite of the AI Builder audience: here "how do I build an agent" is a reason to skip.
// Rules only (free, instant, explainable). Pure functions, browser-safe.
import { detectLanguage } from './classify'

// ─── 1. What to search for ───────────────────────────────────────────────────

export const BUYER_TRADES = [
  { id: 'hvac', label: 'HVAC' }, { id: 'plumber', label: 'plumbing' }, { id: 'roofing', label: 'roofing' },
  { id: 'electrician', label: 'electrical' }, { id: 'pest', label: 'pest control' }, { id: 'landscaping', label: 'landscaping' },
  { id: 'cleaning', label: 'cleaning' },
] as const

export interface BuyerSearch { label: string; q: string; group: 'Missed calls' | 'By trade' | 'Other niches' | 'Competitors'; trade?: string }

const perTrade = (label: string, q: (t: string) => string): BuyerSearch[] =>
  BUYER_TRADES.map((t) => ({ label: `${label}: ${t.label}`, q: q(t.label), group: 'By trade', trade: t.id }))

export const BUYER_SEARCHES: BuyerSearch[] = [
  { group: 'Missed calls', label: 'Missed calls cost my business', q: 'missed calls cost my business' },
  { group: 'Missed calls', label: 'Stop missing customer calls', q: 'how to stop missing customer calls' },
  { group: 'Missed calls', label: 'Can\'t answer while on a job', q: 'never answer the phone while working on a job' },
  { group: 'Missed calls', label: 'Answering service', q: 'answering service for small business' },
  { group: 'Missed calls', label: 'Virtual receptionist', q: 'virtual receptionist small business' },
  { group: 'Missed calls', label: 'After-hours calls', q: 'after hours calls contractor' },
  ...perTrade('More leads', (t) => `how to get more ${t} leads`),
  ...perTrade('Owner mistakes', (t) => `${t} business owner mistakes`),
  ...perTrade('How I grew', (t) => `how I grew my ${t} business`),
  ...perTrade('First year', (t) => `${t} business first year`),
  ...perTrade('Hire a receptionist?', (t) => `should I hire a receptionist ${t}`),
  { group: 'Other niches', label: 'Law firm intake', q: 'law firm intake missed calls', trade: 'law_pi' },
  { group: 'Other niches', label: 'Solo attorney intake', q: 'solo attorney client intake', trade: 'law_pi' },
  { group: 'Other niches', label: 'Dental front desk', q: 'dental office front desk problems', trade: 'dental' },
  { group: 'Other niches', label: 'Med spa booking', q: 'med spa booking system', trade: 'medspa' },
  { group: 'Other niches', label: 'Property manager calls', q: 'property manager tenant calls', trade: 'property_mgmt' },
  { group: 'Other niches', label: 'Real estate missed leads', q: 'real estate agent missed leads', trade: 'real_estate' },
  { group: 'Competitors', label: 'Smith.ai review', q: 'Smith.ai review' },
  { group: 'Competitors', label: 'Ruby receptionist review', q: 'Ruby receptionist review' },
  { group: 'Competitors', label: 'Goodcall review', q: 'Goodcall review' },
  { group: 'Competitors', label: 'Rosie AI review', q: 'Rosie AI receptionist review' },
  { group: 'Competitors', label: 'AI phone agent, small business', q: 'AI phone agent for small business' },
  { group: 'Competitors', label: 'Is an AI receptionist worth it', q: 'is AI receptionist worth it' },
  ...BUYER_TRADES.map((t): BuyerSearch => ({ group: 'Competitors', label: `AI receptionist for ${t.label}`, q: `AI receptionist for ${t.label}`, trade: t.id })),
]

// ─── 2. Trades ───────────────────────────────────────────────────────────────

// Text → Lead Finder niche id (lib/finder/niches.ts), most specific first
const TRADE_RE: Array<[RegExp, string]> = [
  [/\b(hvac|heating (and|&) (cooling|air)|air condition\w*|a\/c (repair|company|business|tech)|furnace|heat pump)\b/i, 'hvac'],
  [/\b(plumb\w*|drain cleaning|rooter|septic)\b/i, 'plumber'],
  [/\b(roof\w*|gutters?)\b/i, 'roofing'],
  [/\b(electrician|electrical (contractor|business|company|work)|electric company)\b/i, 'electrician'],
  [/\b(pest control|exterminat\w*|termite)\b/i, 'pest'],
  [/\b(landscap\w*|lawn care|lawn (business|company|service)|tree (service|removal|trimming)|mowing)\b/i, 'landscaping'],
  [/\b(cleaning (business|company|service)|house ?cleaning|maid service|janitorial|pressure washing|power washing|carpet cleaning)\b/i, 'cleaning'],
  [/\bgarage doors?\b/i, 'garage_door'],
  [/\b(auto (repair|shop)|mechanic shop|body shop|tire shop|towing)\b/i, 'auto_repair'],
  [/\b(dental|dentist\w*|orthodont\w*)\b/i, 'dental'],
  [/\b(med ?spa|medical spa|aesthetics? (clinic|practice)|botox|injector)\b/i, 'medspa'],
  [/\bchiropract\w*\b/i, 'chiropractor'],
  [/\b(veterinar\w*|vet clinic|animal hospital)\b/i, 'vet'],
  [/\b(law firm|attorney|lawyer|legal practice|paralegal|client intake)\b/i, 'law_pi'],
  [/\b(property manag\w*|tenants?|landlord|rental properties)\b/i, 'property_mgmt'],
  [/\b(real estate|realtor|brokerage|listing agent)\b/i, 'real_estate'],
  [/\b(insurance agen\w*)\b/i, 'insurance'],
  [/\b(hair salon|barber ?shop|nail salon|beauty salon|my salon)\b/i, 'salon'],
  [/\b(accounting firm|bookkeep\w*|cpa firm|tax (office|practice))\b/i, 'accounting'],
]

/** The trade a text is about (first match across the texts given, in order) */
export function detectTrade(...texts: Array<string | null | undefined>) {
  for (const t of texts) if (t) for (const [re, id] of TRADE_RE) if (re.test(t)) return id
  return null
}

// ─── 3. Comment phrases ──────────────────────────────────────────────────────

interface Phrase { key: string; re: RegExp; label: string }

const HIGH: Phrase[] = [
  { key: 'miss_calls', label: 'Says they miss calls', re: /\bmiss(ing|ed|es)?\b.{0,30}\b(calls?|the phone|phone calls)\b|\b(calls?|phone)\b.{0,15}\b(get|gets|got|go|goes|went|going)\s+(missed|unanswered)\b|\bunanswered calls?\b/i },
  { key: 'cant_answer', label: 'Can\'t answer the phone while working', re: /\b(can'?t|cannot|can not|couldn'?t|unable to|don'?t have time to|never have time to|hard to|impossible to)\s+(always\s+|even\s+)?(answer|pick up|get to|take)\s+(the|my|our|every|all the|all my)?\s*(phone|calls?)\b/i },
  { key: 'lost_job', label: 'Lost work because of it', re: /\blost\s+(a|the|so many|several|many|some|\d+|a lot of|a few)?\s*(big\s+)?(jobs?|customers?|clients?|leads?|sales?|contracts?|business|work)\b.{0,50}\b(because|since|when|after|due to|voice ?mail|calls?|phone|answer\w*|pick\w* up)\b/i },
  { key: 'voicemail', label: 'Customers go to voicemail', re: /\b(go|goes|going|went|straight|sent|ends? up|ended up|rolls?|rolled)\s+(straight\s+|right\s+|directly\s+)?to\s+voice ?mail\b|\b(customers?|clients?|callers?|leads?|people)\b.{0,30}\bvoice ?mail\b/i },
  { key: 'need_receptionist', label: 'Needs / is looking for a receptionist', re: /\b(need|needs|needed|looking for|want to hire|have to hire|should (i|we) (hire|get)|thinking (about|of) (hiring|getting)|about to hire)\b.{0,45}\b(receptionist|someone to answer|somebody to answer|answering service|call answering|front desk|office (manager|admin)|dispatcher)\b/i },
  { key: 'answering_service_rec', label: 'Asks for an answering-service recommendation', re: /\b(answering service|virtual receptionist|call answering|call center)\b.{0,50}(\b(recommend\w*|suggest\w*|which (one|company|service)|who do you use|any good|worth it)\b|\?)|\b(recommend\w*|suggest\w*|which|best)\b.{0,40}\b(answering service|virtual receptionist)\b/i },
  { key: 'ask_ai_receptionist', label: 'Asks if anyone uses an AI receptionist', re: /\b(anyone|anybody|any one|has anyone|does anyone|who (here )?(uses|is using))\b.{0,40}\b(ai (receptionist|phone|answering|voice|agent)|virtual receptionist|answering service)\b/i },
  { key: 'what_use_calls', label: 'Asks what others use for calls', re: /\bwhat\b.{0,25}\b(do you|are you|does everyone|do y'?all|do you guys|did you)\b.{0,12}\b(use|using)\b.{0,30}\b(calls?|phones?|answer\w*|booking|scheduling)\b/i },
  { key: 'no_callback', label: 'Talks about calls not being returned', re: /\b(no ?one|nobody|never)\s+(ever\s+)?(called|calls|got back|returned|answers?|answered|picks? up|picked up)\b|\bcall(ed|ing|s)?\s+(me|us|them|people|customers|everyone)?\s*back\b/i },
]
// "too expensive" only counts when it is about a receptionist / answering service
const ASKING = new Set(['answering_service_rec', 'ask_ai_receptionist', 'what_use_calls'])
const TOO_EXPENSIVE = /\b(too|so|way too|really|pretty|super)\s+(expensive|pricey|costly)\b|\bcan'?t afford\b|\bcosts? (too much|a fortune)\b/i
const RECEPTION_TOPIC = /\b(ruby|smith\.?ai|receptionist|answering service|front desk|call answering|goodcall|rosie)\b/i

const MEDIUM: Phrase[] = [
  { key: 'runs_business', label: 'Runs a business', re: /\b(i|we)\s+(run|own|operate|started|have|manage)\s+(a|an|my own|my|our|the)\s+([\w&' -]{0,30}?\s)?(business|company|shop|firm|practice|clinic|office|crew|salon|spa|llc|dealership|franchise)\b|\b(business|shop|practice|company) owner\b/i },
  { key: 'my_company', label: 'Talks about "my company / shop / crew"', re: /\b(my|our)\s+(own\s+)?(company|shop|crew|business|practice|firm|office|clinic|techs?|technicians|guys|customers|clients|patients|front desk|office staff)\b/i },
  { key: 'one_man', label: 'One-person operation', re: /\b(one[- ](man|woman|person)|owner[- ]operator|solo (operator|operation|practice|shop)|just me|it'?s only me|by myself|me and (my|one|a|two) (guy|guys|helper|helpers|son|wife|brother|partner))\b/i },
  { key: 'after_hours', label: 'After hours / on a job site', re: /\b(after[- ]hours|on weekends?|at night|on (a|the) job ?site|on (a|the) job|in the field|on (a|the) roof|up (on )?a ladder|under a (sink|house)|in (an|the) attic|in a crawl ?space|while (i'?m|we'?re) (working|driving)|with a (customer|client|patient))\b/i },
  { key: 'booking', label: 'Booking / scheduling / appointments', re: /\b(bookings?|scheduling|appointments?|dispatch\w*|estimates?|service calls?)\b/i },
  { key: 'hire_answer', label: 'Would pay someone to answer', re: /\b(hire|hired|hiring|pay|paying|paid)\s+(someone|somebody|a person|my wife|a girl|a guy|a va|a virtual assistant|a receptionist)\b.{0,30}\b(answer|phones?|calls?)\b/i },
]

const LOW: Phrase[] = [
  { key: 'get_customers', label: 'Asks how to get customers', re: /\bhow (do|can|did|would) (i|you|we|one) (get|find|land) (more |new )?(customers|clients|leads|jobs|work|patients)\b/i },
]
const HELPFUL = /\b(helpful|great (info|advice|video|tips)|good (info|advice|tips)|thanks? (for|you)|needed (this|to hear)|taking notes)\b/i

const NEGATIVE: Phrase[] = [
  { key: 'builder', label: 'Builder or learner, not a buyer', re: /\b(how (to|do (i|you)) (build|make|create|set ?up) (an? |this |my own )?(ai|voice|agent|bot|receptionist)|build(ing)? (an? |my own )?(ai|voice) (agent|receptionist|bot|assistant)|tutorial|step[- ]by[- ]step guide|source code|github|api key|prompt (engineering|template))\b/i },
  { key: 'learner', label: 'Student / beginner', re: /\b(i'?m|i am|as) (a |an |still |just )?(student|beginner|newbie|learning)\b|\bjust (starting|started) (to )?learn\w*\b/i },
  { key: 'agency', label: 'AI agency / freelancer (competitor)', re: /\b(ai (automation )?agency|automation agency|my agency|i sell (this|these|ai)|sell (this|it|these) to (businesses|clients)|for my clients|white[- ]?label|i build (these|ai|agents|bots|voice)|freelanc\w*|n8n|vapi|retell|make\.com|zapier|synthflow|bland\.?ai|gohighlevel|\bghl\b|voiceflow)\b/i },
]

const SPAM = [
  /\b(t\.me|telegram|whats\s?app|wa\.me)\b/i,
  /\b(crypto|bitcoin|forex|trading signals?|expert trader|financial advis[eo]r|passive income|recovered my|spell ?caster)\b/i,
  /\b(sub4sub|check (out )?my channel|subscribe to my|visit my channel)\b/i,
  /(.)\1{7,}/,
]

// A high-intent phrase only counts when the commenter is talking about themselves. "Small
// businesses miss a lot of calls" and "this AI receptionist sounds useful" are opinions about a
// product (and the usual wording of paid or bot comments under sellers' videos), not a problem
// someone has.
const FIRST_PERSON = /\b(i|i'm|im|i've|ive|i'd|i'll|we|we're|we've|my|our|me|us|mine|myself)\b/gi
const GENERIC_SUBJECT = /\b((small|local|service|most|many|some|other|these|those) )?(business(es)?( owners?)?|companies|owners|contractors|people|they|their|anyone who|everyone|teams?)\b/gi
const IMPLICIT_SELF = /^(missed|lost|can'?t|cannot|couldn'?t|need(ed)?|looking for|had to|have to|been missing|keep missing|always missing)\b/i
const PRODUCT_PRAISE = /\b(ai receptionist|ai agent|this (ai|tool|solution|system|software|service|platform|product)|it|that)\b.{0,50}\b(sounds?|seems?|looks?|is|would be|could be|can be|will be)\b.{0,20}\b(useful|helpful|great|smart|amazing|awesome|perfect|a good idea|game.?changer|a real difference|a huge difference|exactly what)\b|\b(such a |a |really )?(smart|great|amazing|good|brilliant|awesome|fantastic|perfect) (solution|idea|tool|concept|way|option)\b|\b(makes (a lot of |total |perfect )?sense|so true|well explained|love this|great (video|content|breakdown|explanation))\b/i

function lastIndex(re: RegExp, text: string) {
  let at = -1
  for (const m of text.matchAll(re)) at = m.index ?? at
  return at
}

/** Is this phrase, where it sits in the comment, about the commenter's own business? */
function aboutThemselves(text: string, at: number, length: number, anyFirstPerson: boolean) {
  const start = Math.max(text.lastIndexOf('.', at - 1), text.lastIndexOf('!', at - 1), text.lastIndexOf('?', at - 1), text.lastIndexOf('\n', at - 1)) + 1
  const before = text.slice(start, at)
  const me = lastIndex(FIRST_PERSON, before)
  const them = lastIndex(GENERIC_SUBJECT, before)
  if (them > me) return false // "…small businesses that often miss calls"
  if (me >= 0) return true // "I miss so many calls"
  const after = text.slice(at, at + length + 40)
  if (FIRST_PERSON.test(after)) { FIRST_PERSON.lastIndex = 0; return true } // "can't answer the phone while I'm on a roof"
  FIRST_PERSON.lastIndex = 0
  // Dropped subject at the start of a sentence: "Lost a big job last week…", "Missed 3 calls today"
  return anyFirstPerson && !before.trim() && IMPLICIT_SELF.test(text.slice(at))
}

export const BUYER_SIGNAL_LABEL: Record<string, string> = Object.fromEntries(
  [...HIGH, ...MEDIUM, ...LOW, ...NEGATIVE].map((p) => [p.key, p.label]).concat([
    ['too_expensive', 'Finds Ruby / Smith.ai too expensive'], ['helpful_on_trade', 'Engaged on a trade video'],
    ['non_english', 'Not in English'], ['short', 'Too short to tell'], ['spam', 'Spam'],
    ['product_praise', 'Only praises the product (typical of paid or bot comments)'], ['duplicate', 'Same text posted by several accounts'],
  ]),
)
const HIGH_KEYS = new Set([...HIGH.map((p) => p.key), 'too_expensive'])
const NEGATIVE_KEYS = new Set([...NEGATIVE.map((p) => p.key), 'non_english', 'product_praise', 'duplicate', 'spam'])

export interface BuyerVerdict { points: number; signals: string[]; high: boolean; relevance: 'HIGH' | 'MEDIUM' | 'LOW' | 'SPAM'; trade: string | null }

/**
 * Score one comment: +5 per high-intent phrase, +3 medium, +1 low, -5 per negative signal.
 * `videoText` is the title of the video it was left on (context for "too expensive" and the trade).
 */
export function classifyBuyerComment(text: string, ctx: { videoText?: string | null; authorName?: string } = {}): BuyerVerdict {
  const t = text.trim()
  const none = { points: 0, high: false, trade: null }
  if (SPAM.some((re) => re.test(t)) || /telegram|whats\s?app|\+\d{6,}/i.test(ctx.authorName || '')) return { ...none, signals: ['spam'], relevance: 'SPAM' }
  if (t.split(/\s+/).filter(Boolean).length < 6) return { ...none, signals: ['short'], relevance: 'LOW' }

  const signals: string[] = []
  let points = 0
  const anyFirstPerson = FIRST_PERSON.test(t)
  FIRST_PERSON.lastIndex = 0
  for (const p of HIGH) {
    const m = t.match(p.re)
    // Questions to the room ("anyone use…?", "what do you use for calls?") are requests by nature
    if (m && (ASKING.has(p.key) || aboutThemselves(t, m.index || 0, m[0].length, anyFirstPerson))) { signals.push(p.key); points += 5 }
  }
  if (anyFirstPerson && TOO_EXPENSIVE.test(t) && (RECEPTION_TOPIC.test(t) || RECEPTION_TOPIC.test(ctx.videoText || ''))) { signals.push('too_expensive'); points += 5 }
  for (const p of MEDIUM) if (p.re.test(t)) { signals.push(p.key); points += 3 }
  for (const p of LOW) if (p.re.test(t)) { signals.push(p.key); points += 1 }
  const trade = detectTrade(t, ctx.videoText)
  if (!signals.length && trade && HELPFUL.test(t)) { signals.push('helpful_on_trade'); points += 1 }
  for (const p of NEGATIVE) if (p.re.test(t)) { signals.push(p.key); points -= 5 }
  if (detectLanguage(t) === 'other') { signals.push('non_english'); points -= 5 }
  // Praise for the product with no problem of their own: no points, and never high intent
  if (PRODUCT_PRAISE.test(t) && !signals.some((s) => HIGH_KEYS.has(s))) { signals.push('product_praise'); points = Math.min(points, 1) }
  else if (PRODUCT_PRAISE.test(t) && !/\b(i|we)\s+(run|own|operate|have|manage|started)\b|\bmy (own )?(company|shop|crew|practice|firm|business)\b/i.test(t)) { signals.push('product_praise'); points -= 5 }

  const high = signals.some((s) => HIGH_KEYS.has(s)) && !signals.some((s) => NEGATIVE_KEYS.has(s))
  return { points, signals, high, trade, relevance: points >= 8 ? 'HIGH' : points >= 5 ? 'MEDIUM' : 'LOW' }
}

export const isHighSignal = (s: string) => HIGH_KEYS.has(s)
export const isNegativeSignal = (s: string) => NEGATIVE_KEYS.has(s)

// ─── 4. Is the commenter a real business? ────────────────────────────────────

const BUSINESS_NAME = /\b(plumbing|plumbers?|hvac|heating|cooling|air conditioning|mechanical|electric(al)?|roofing|roofers?|gutters?|construction|contracting|contractors?|landscap\w+|lawn ?care|lawn|tree service|pest control|exterminat\w+|cleaning|maids?|janitorial|pressure washing|garage doors?|automotive|auto repair|auto body|towing|dental|dentistry|orthodontics|chiropractic|law (firm|office|group)|attorneys?|realty|real estate|properties|property management|insurance|salon|barber ?shop|med ?spa|aesthetics|clinic|veterinary|animal hospital|painting|painters|flooring|remodel\w+|renovations?|handyman|home (services|improvement|repair)|(home|custom) builders?|restoration|septic|drywall|concrete|paving|fencing|pools?|solar|locksmith|movers|moving|appliance repair|carpentry|masonry|excavat\w+|llc|l\.l\.c|inc|corp|& sons|and sons|enterprises)\b/i

/** A channel name that is a company or a trade ("Mike's Plumbing"), not a person's name */
export function businessNameOf(channelTitle: string) {
  const name = channelTitle.replace(/^@/, '').trim()
  return name.length >= 4 && BUSINESS_NAME.test(name) ? name : null
}

const US_STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
}
const STATE_NAME_RE = new RegExp(`\\b(${Object.keys(US_STATES).join('|')})\\b`, 'i')
const CITY_STATE_RE = /\b([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z]+){0,2}),\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/

/** A US city or state the person mentions ("Tampa, FL", "here in Texas") */
export function usLocation(...texts: Array<string | null | undefined>): { city?: string; state: string } | null {
  for (const t of texts) {
    if (!t) continue
    const cs = t.match(CITY_STATE_RE)
    if (cs) return { city: cs[1], state: cs[2] }
    const st = t.match(new RegExp(`\\b(in|from|out of|based in|serving|here in|located in|down in|up in)\\s+(?:[A-Z][a-z]+,?\\s+)?${STATE_NAME_RE.source.replace(/^\\b|\\b$/g, '')}\\b`, 'i'))
    if (st) return { state: US_STATES[st[2].toLowerCase()] }
  }
  return null
}

/**
 * Tier A (reach out now): a high-intent phrase plus a business name or website.
 * Tier B (reply publicly and watch): a high-intent phrase but no business details.
 * Tier C (ignore): everything else, and anyone the negatives outweigh.
 */
export function tierOf(b: { high: boolean; score: number; businessName?: string | null; website?: string | null; country?: string | null }): 'A' | 'B' | 'C' {
  if (!b.high || b.score < 5) return 'C'
  // Outside the US there is no way to confirm they serve US customers
  if (b.country && !['US', 'CA'].includes(b.country.toUpperCase())) return 'C'
  return b.businessName || b.website ? 'A' : 'B'
}

// ─── 5. Videos worth reading ─────────────────────────────────────────────────

const OWNER_TOPIC = /\b(business owners?|small business|contractors?|my business|grow(ing|n|th)?|leads?|customers|first year|mistakes|receptionist|answering service|missed calls|front desk|intake|booking|after hours|phone)\b/gi
const BUILDER_VIDEO = /\b(how to build|build (an?|your own) (ai|voice)|n8n|vapi|retell|make\.com|zapier|tutorial|no[- ]code|automation agency|sell ai)\b/i
// Made by someone selling AI receptionists or teaching others to: the comments are paid, bots or resellers
const SELLER_VIDEO = /\b(sell(ing)? (the|this|them|it|ai|an ai)|i'?d sell|\$\d+\s*(\/|per|a)\s*(mo|month)|gohighlevel|go high level|\bghl\b|white[- ]?label|saas|agency|resell\w*|side hustle|make money|passive income)\b|#\s?ai\s?receptionist/i

/** How likely a video's comment section is full of business owners (0-100), with reasons */
export function scoreBuyerVideo(v: { title: string; description?: string | null; viewCount: number; commentCount: number; publishedAt?: Date | null; durationSeconds: number }) {
  const reasons: string[] = []
  let score = 0
  const text = `${v.title} ${(v.description || '').slice(0, 300)}`
  const trade = detectTrade(v.title, v.description?.slice(0, 300))
  if (trade) { score += 20; reasons.push('about a trade') }
  const topics = new Set((text.match(OWNER_TOPIC) || []).map((w) => w.toLowerCase())).size
  if (topics) { score += Math.min(20, topics * 7); reasons.push('speaks to business owners') }
  if (BUILDER_VIDEO.test(v.title)) { score -= 25; reasons.push('a build tutorial: the comments are builders, not buyers') }
  else if (SELLER_VIDEO.test(v.title)) { score -= 30; reasons.push('made by someone selling AI receptionists: comments are mostly paid or bots') }

  // 5K-200K views: big enough to have comments, small enough that they are not noise
  const views = v.viewCount
  if (views >= 5_000 && views <= 200_000) { score += 25; reasons.push(`${views.toLocaleString('en-US')} views (ideal range)`) }
  else if (views > 200_000) { score += 8; reasons.push(`${views.toLocaleString('en-US')} views: a lot of noise`) }
  else if (views >= 1_000) { score += 10; reasons.push(`${views.toLocaleString('en-US')} views`) }
  else reasons.push('very few views')

  const c = v.commentCount
  if (c >= 50) score += 15
  else if (c >= 15) score += 8
  else if (c < 5) score -= 20
  reasons.push(`${c.toLocaleString('en-US')} comments`)

  const ageDays = v.publishedAt ? (Date.now() - v.publishedAt.getTime()) / 86_400_000 : 999
  if (ageDays <= 31) { score += 20; reasons.push('this month') }
  else if (ageDays <= 120) { score += 12; reasons.push('recent') }
  else if (ageDays <= 365) score += 5
  else if (ageDays > 730) { score -= 5; reasons.push('older than 2 years') }

  if (v.durationSeconds > 0 && v.durationSeconds <= 60) { score -= 15; reasons.push('a Short: drive-by comments') }
  // YouTube search pads its results with unrelated videos: only ones about a trade or about running a business count
  return { score: Math.max(0, Math.min(100, score)), reasons, trade, onTopic: !!trade || topics > 0 }
}

// ─── 6. What to reply publicly (Tier B) ──────────────────────────────────────
// Helpful first, no pitch, no link. Several wordings per situation so no two replies are the
// same text (YouTube treats repeated text as spam). Always adapt before posting.

const REPLIES: Record<string, string[]> = {
  miss_calls: [
    'That\'s a painful one. A lot of owners say the calls they miss while on a job are the ones that turn into the best customers. Even a simple voicemail greeting that asks for name, address and the issue can save a few of them.',
    'Missed calls add up fast. One thing that helps right away: text back within a couple of minutes ("sorry I missed you, on a job, what do you need?"). Most people will wait for the first person who answers.',
    'You\'re not alone, this comes up constantly. Worth counting your missed calls for one week: most owners are surprised how many there are, and it makes it easier to decide what to do about it.',
  ],
  cant_answer: [
    'Hard to answer with your hands full. A greeting that says "I\'m on a job, leave your name, address and the problem and I\'ll call back by 5" gets a lot more messages than a default voicemail.',
    'Same story from most people who do the work themselves. Blocking two set call-back times a day (lunch and end of day) and saying so in your voicemail helps customers wait instead of calling the next company.',
  ],
  voicemail: [
    'Voicemail is where most new customers give up: they just call the next name on the list. An automatic text ("got your call, what\'s the address and issue?") keeps a surprising number of them.',
    'That\'s the leak for a lot of small shops. If you can, have calls ring a second phone after 3 rings before voicemail picks up: even a family member taking a name and number beats voicemail.',
  ],
  lost_job: [
    'That stings, especially when it was a good job. Tracking where each lost job went (voicemail, slow call-back, price) for a month usually shows the phone is a bigger part than people expect.',
    'Been hearing this a lot. The fix that costs nothing: return every missed call within 10 minutes, even just to say "I\'m on a job, can I call you at 4?" It holds the customer.',
  ],
  after_hours: [
    'After-hours calls are the biggest leak I see for trades: those are often emergencies, and emergencies pay. Even a greeting that gives an emergency text number makes a difference.',
    'Evenings and weekends are when people actually have time to call. A voicemail that promises a call-back first thing in the morning, with a time, keeps more of them than you\'d think.',
  ],
  need_receptionist: [
    'Before hiring, it helps to write down what the person would actually do each call: take name, address and issue, book a slot, flag emergencies. That list makes it easy to compare a hire, an answering service or software.',
    'Worth working out your number first: missed calls per week x how many would have booked x your average job. That tells you what you can spend on someone answering.',
  ],
  too_expensive: [
    'The per-minute plans do get expensive once call volume grows. If you compare options, ask each one what a month with your actual call count would cost, not the starting price.',
    'Agreed, those add up. The useful comparison is cost per answered call versus what one booked job is worth to you.',
  ],
  generic: [
    'Good point. The phone is the part most owners don\'t have time for, and it\'s usually where new customers decide who to hire.',
    'Appreciate you sharing that. How are you handling calls right now when you\'re on a job?',
  ],
}
const REPLY_ORDER = ['miss_calls', 'cant_answer', 'voicemail', 'lost_job', 'need_receptionist', 'too_expensive', 'after_hours']

/** A starting point for a public reply: picked by what they said, varied per person */
export function suggestReply(id: string, signals: string[]) {
  const key = REPLY_ORDER.find((k) => signals.includes(k)) || (signals.some((s) => ['answering_service_rec', 'ask_ai_receptionist', 'what_use_calls', 'hire_answer'].includes(s)) ? 'need_receptionist' : 'generic')
  const options = REPLIES[key]
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return options[h % options.length]
}

export const REPLY_RULES = [
  'At most 10 to 15 replies a day from one account, and change the wording each time.',
  'No links in the first public reply.',
  'Be helpful first; share the demo number only if they answer.',
  'Say who you are if asked. Never pose as a customer.',
]
