// Finding a way to reach a local business, cheapest and most reliable source first:
//
//   1. the listing itself (OpenStreetMap and Foursquare often carry an email)
//   1b. no website on the listing (registry sources never have one): find it by web search
//   2. their own website: home, contact, about/team, privacy pages; mailto, Cloudflare-hidden,
//      JSON-LD and "name [at] domain" addresses; the owner / lead doctor; booking & chat tools
//   3. web-search API: pages that mention "@theirdomain.com" (directories, chambers, PDFs)
//   4. owner's name from a LinkedIn *search result title* (LinkedIn itself is never fetched)
//   5. email finders, one after another: Hunter (free "does Hunter know this domain" check
//      first), Apollo, Prospeo, Tomba. A finder whose keys are used up is skipped
//   6. guesses (owner / info@ / office@…) kept ONLY if a verifier confirms the mailbox
//
// Every step is logged, so the UI can show exactly where we looked.
import { fetchHtml, hostOf, htmlToText, parsePage, patternGuesses, SHARED_HOSTS } from '../audience/enrich'
import { emailTraits, FREE_MAIL, normalizeEmail, isUsableEmail, verifierProvider, verifyEmail, verifyWithHunter } from '../audience/verify'
import { searchProvider, webSearch } from '../audience/identity'
import { findBusinessEmail, finderProviders } from '../audience/finders'
import { hunterAccount, hunterConfigured, hunterEmailCount } from '../audience/hunter'
import { getAudienceSettings } from '../audience/settings'
import type { Niche } from './niches'
import type { FinderSettings } from './settings'
import { budgetLeft, spend } from '../budget'
import { NoKeyError } from '../providers/keys'

export type BizEmailSource = 'LISTING' | 'WEBSITE' | 'SEARCH' | 'HUNTER' | 'APOLLO' | 'TOMBA' | 'PROSPEO' | 'PATTERN' | 'ROLE_GUESS' | 'MANUAL'

export interface FoundBizEmail {
  email: string
  source: BizEmailSource
  sourceUrl?: string
  personName?: string
  position?: string
  confidence?: number
  status?: 'VERIFIED' | 'RISKY' | 'UNKNOWN' | 'INVALID'
  verifyMethod?: string
  verifyDetail?: string
}

export interface Research {
  emails: FoundBizEmail[]
  /** Their own site, when the listing had none and a web search found it */
  website?: string
  /** The website search couldn't run (daily budget or credits used up): try this business again later */
  deferred?: boolean
  phone?: string
  contactFormUrl?: string
  facebook?: string
  instagram?: string
  linkedIn?: string
  ownerName?: string
  ownerTitle?: string
  ownerSource?: string
  techSignals: string[]
  siteFacts: string[]
  log: string[]
}

const SOCIAL_SITE = /(^|\.)(facebook\.com|fb\.com|instagram\.com|business\.site|linktr\.ee|yelp\.com|google\.com|goo\.gl|g\.page|nextdoor\.com|healthgrades\.com|zocdoc\.com|angi\.com|homeadvisor\.com|thumbtack\.com)$/i

// Booking, chat and phone tools that show up in page source. Worth knowing before a call:
// an existing AI receptionist is a competitor; Podium/Weave means they already pay for patient comms.
const TECH: Array<[RegExp, string]> = [
  [/nexhealth/i, 'Online booking (NexHealth)'], [/localmed/i, 'Online booking (LocalMed)'], [/zocdoc/i, 'Listed on Zocdoc'],
  [/solutionreach/i, 'Patient messaging (Solutionreach)'], [/lighthouse360|lh360/i, 'Patient messaging (Lighthouse 360)'],
  [/getweave|weave\.com/i, 'Phones & texting (Weave)'], [/podium\.com|podium-webchat|podiumwebchat/i, 'Webchat (Podium)'],
  [/birdeye/i, 'Reviews & webchat (Birdeye)'], [/demandforce/i, 'Patient comms (Demandforce)'], [/revenuewell/i, 'Patient comms (RevenueWell)'],
  [/modento/i, 'Patient app (Modento)'], [/yapiapp|yapi\.me/i, 'Patient forms (YAPI)'], [/patientpop|tebra/i, 'Practice marketing (Tebra/PatientPop)'],
  [/calendly\.com/i, 'Online booking (Calendly)'], [/acuityscheduling/i, 'Online booking (Acuity)'], [/vagaro/i, 'Online booking (Vagaro)'],
  [/mindbodyonline|mindbody\.io/i, 'Online booking (Mindbody)'], [/joinblvd|boulevard\.io/i, 'Online booking (Boulevard)'], [/setmore/i, 'Online booking (Setmore)'],
  [/housecallpro/i, 'Field service software (Housecall Pro)'], [/servicetitan/i, 'Field service software (ServiceTitan)'], [/getjobber|jobber\.com/i, 'Field service software (Jobber)'],
  [/leadconnectorhq|msgsndr|gohighlevel/i, 'CRM & chat (GoHighLevel)'], [/intercom(cdn)?\.(io|com)/i, 'Live chat (Intercom)'], [/drift\.com|driftt/i, 'Live chat (Drift)'],
  [/tidio/i, 'Live chat (Tidio)'], [/livechatinc|livechat\.com/i, 'Live chat (LiveChat)'], [/tawk\.to/i, 'Live chat (tawk.to)'], [/crisp\.chat/i, 'Live chat (Crisp)'],
  [/js\.hs-scripts|hubspot/i, 'HubSpot'], [/smith\.ai/i, 'Answering service (Smith.ai) — competitor'], [/callruby|ruby\.com/i, 'Answering service (Ruby) — competitor'],
  [/arini\.ai|goodcall|dialzara|synthflow|bland\.ai|air\.ai|myaifrontdesk|rosie\.ai/i, 'AI receptionist already — competitor'],
]

// Facts the email templates turn into a personal first line (see lib/signals.ts)
const FACTS: Array<[RegExp, string]> = [
  [/accepting new patients|now accepting (new )?(patients|clients)/i, 'Accepting new patients'],
  [/emergenc(y|ies)/i, 'Emergency appointments'],
  [/24\/7|24 hours a day|open 24 hours/i, '24/7 service'],
  [/skip the (phone )?call|text us (at|today|anytime)/i, 'Text us instead of calling'],
  [/gift card|free (teeth )?whitening|new.patient (special|offer)|\$\d+ off|free (exam|consultation|estimate)/i, 'New-patient special'],
  [/evening (hours|appointments)|saturday appointments|open saturdays/i, 'Evening or Saturday appointments'],
  [/financing|payment plans?|carecredit/i, 'Financing available'],
  [/se habla espa[nñ]ol|hablamos espa[nñ]ol|spanish.speaking/i, 'Spanish-speaking team'],
  [/family.owned|locally owned|independently owned/i, 'Independently owned'],
]

const PAGE_PRIORITY: Array<[RegExp, number]> = [
  [/contact|get-in-touch|reach-us|appointment|book|schedule/i, 3],
  [/about|team|staff|doctor|dentist|provider|meet|our-|who-we-are|leadership|owner|founder/i, 2],
  [/privacy|legal|impressum|terms/i, 1],
]

const DR_NAME = /\bDr\.?\s+([A-Z][a-z]+(?:\s+[A-Z]\.)?(?:\s+[A-Z][a-zA-Z'’-]+)?)/g
const OWNER_AFTER = /\b(owner|founder|co-founder|president|ceo|principal|managing partner|practice owner|lead dentist)\s*[:,–—-]\s*((?:Dr\.?\s+)?[A-Z][a-z]+\s+[A-Z][a-zA-Z'’-]+)/gi
const OWNER_BEFORE = /\b((?:Dr\.?\s+)?[A-Z][a-z]+\s+[A-Z][a-zA-Z'’-]+)\s*,\s*(owner|founder|co-founder|president|ceo|principal|managing partner|DDS|DMD)\b/g
const NAME_STOP = /^(Meet|Our|Team|About|Contact|Family|Dental|Dentistry|Office|Practice|Clinic|Is|Has|And|The|Will|Can|Was|Offers|Provides|Services|Smile|Care|Today|Now|Book|Call|Learn|Read|More|Home|Welcome|DDS|DMD|MD|DC|DVM|PT|NMD|Orthodontics|Periodontics)$/
const NOT_A_NAME = /^(Our|The|Your|Meet|Contact|About|Call|Book|Read|Learn|Privacy|Terms|Home|Dental|Family|Smile|Welcome|New|Best|Top|Why|How|What|Dr)\b/

export function ownDomain(website?: string | null) {
  const host = website ? hostOf(website) : ''
  if (!host || SOCIAL_SITE.test(host) || SHARED_HOSTS.test(host) || FREE_MAIL.has(host)) return ''
  return host
}

/** Does this address belong to the business (its domain, or a free-mail inbox they published)? */
function belongs(email: string, domain: string, linkedHosts: Set<string>, onContactPage: boolean) {
  const d = email.split('@')[1]
  if (domain && (d === domain || d.endsWith(`.${domain}`) || domain.endsWith(`.${d}`))) return true
  if (FREE_MAIL.has(d)) return true // small businesses often run on gmail; published = fine
  // A different domain that the page links to is usually the web designer ("Site by …")
  if (linkedHosts.has(d)) return false
  return onContactPage
}

async function researchWebsite(site: string, niche: Niche | null, r: Research, deadline: number) {
  const home = await fetchHtml(site, 10_000)
  if (!home) { r.log.push(`Website ${hostOf(site)}: not reachable, or it blocks automated visits (robots.txt)`); return '' }
  const host = hostOf(home.url)
  const domain = ownDomain(home.url) || ownDomain(site)
  const first = parsePage(home.html, home.url)
  const sameSite = first.links.filter((l) => { try { return hostOf(l) === host && !/\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4)$/i.test(new URL(l).pathname) } catch { return false } })
  const ranked = [...new Set(sameSite.map((l) => l.split('#')[0].replace(/\/+$/, '')))]
    .map((l) => ({ l, p: PAGE_PRIORITY.find(([re]) => re.test(new URL(l).pathname))?.[1] || 0 }))
    .filter((x) => x.p > 0 && x.l !== home.url.replace(/\/+$/, ''))
    .sort((a, b) => b.p - a.p)
    .slice(0, 5)
    .map((x) => x.l)
  if (!ranked.some((l) => /contact/i.test(l))) ranked.unshift(`https://${host}/contact`, `https://${host}/contact-us`)

  const pages = [{ ...home, facts: first }]
  for (const url of ranked.slice(0, 6)) {
    if (deadline - Date.now() < 6_000) break
    const p = await fetchHtml(url, 7_000)
    if (p) pages.push({ ...p, facts: parsePage(p.html, p.url) })
  }

  let allText = ''
  const drNames = new Map<string, number>()
  for (const p of pages) {
    const text = htmlToText(p.html)
    allText += ` ${text}`
    const linkedHosts = new Set(p.facts.links.map((l) => hostOf(l)).filter((h) => h && h !== host))
    const isContact = /contact|appointment/i.test(new URL(p.url).pathname)
    for (const email of p.facts.emails) {
      if (!belongs(email, domain, linkedHosts, isContact)) continue
      if (!r.emails.some((e) => e.email === email)) r.emails.push({ email, source: 'WEBSITE', sourceUrl: p.url })
    }
    // Contact form (a real one: has a message box)
    if (!r.contactFormUrl && /<form[\s\S]{0,4000}?<textarea/i.test(p.html)) r.contactFormUrl = p.url
    for (const l of p.facts.links) {
      if (/facebook\.com\/(?!sharer|share|dialog|plugins|tr\?)[^/?#]{3,}/i.test(l)) r.facebook ||= l.split('?')[0]
      else if (/instagram\.com\/(?!p\/|explore)[^/?#]{2,}/i.test(l)) r.instagram ||= l.split('?')[0]
      else if (/linkedin\.com\/(company|in)\//i.test(l)) r.linkedIn ||= l.split('?')[0]
    }
    if (!r.phone) r.phone = p.html.match(/href\s*=\s*["']tel:([+\d\s().-]{7,20})["']/i)?.[1]?.trim()
    if (p.facts.person?.name && !r.ownerName && /[a-z]\s+[a-z]/i.test(p.facts.person.name)) {
      r.ownerName = p.facts.person.name.trim(); r.ownerTitle = p.facts.person.jobTitle; r.ownerSource = 'Website (structured data)'
    }
    for (const m of text.matchAll(DR_NAME)) {
      // "Dr. Osterkamp Meet the team" → "Osterkamp": drop the words that follow a name in nav text
      const words = m[1].trim().split(/\s+/)
      while (words.length > 1 && NAME_STOP.test(words[words.length - 1])) words.pop()
      const n = words.join(' ')
      if (!NOT_A_NAME.test(n) && !NAME_STOP.test(words[0])) drNames.set(n, (drNames.get(n) || 0) + 1)
    }
    if (!r.ownerName) {
      const m = [...text.matchAll(OWNER_AFTER)][0]
      const b = [...text.matchAll(OWNER_BEFORE)][0]
      if (m && !NOT_A_NAME.test(m[2])) { r.ownerName = m[2]; r.ownerTitle = m[1]; r.ownerSource = `Website (${new URL(p.url).pathname})` }
      else if (b && !NOT_A_NAME.test(b[1].replace(/^Dr\.?\s+/, ''))) {
        // "Travis Royce, DDS" is Dr. Royce: the emails greet and mention doctors by title
        r.ownerName = /^(DDS|DMD)$/i.test(b[2]) && !/^Dr/i.test(b[1]) ? `Dr. ${b[1]}` : b[1]
        r.ownerTitle = b[2]; r.ownerSource = `Website (${new URL(p.url).pathname})`
      }
    }
    for (const [re, label] of TECH) if (re.test(p.html) && !r.techSignals.includes(label)) r.techSignals.push(label)
  }
  // Clinics: the doctor named most often is almost always the owner
  if (!r.ownerName && drNames.size && (niche?.group === 'Health')) {
    // Surname-only mentions count toward the full name they belong to
    for (const [n, c] of [...drNames]) {
      if (n.includes(' ')) continue
      const full = [...drNames.keys()].find((k) => k.includes(' ') && k.endsWith(` ${n}`))
      if (full) { drNames.set(full, (drNames.get(full) || 0) + c); drNames.delete(n) }
    }
    const [name] = [...drNames.entries()].sort((a, b) => b[1] - a[1])[0]
    r.ownerName = `Dr. ${name}`; r.ownerTitle = 'Doctor'; r.ownerSource = 'Website (most-mentioned doctor)'
  }
  for (const [re, label] of FACTS) if (re.test(allText) && !r.siteFacts.includes(label)) r.siteFacts.push(label)
  const since = allText.match(/\b(?:since|established|est\.?|serving [\w\s,]{0,30} since)\s+(19[4-9]\d|20[01]\d)\b/i)?.[1]
  if (since) r.siteFacts.push(`Since ${since}`)
  const locations = allText.match(/\b(\d|two|three|four|five)\s+(?:convenient\s+)?(?:locations|offices|clinics)\b/i)?.[1]
  if (locations) {
    const n = Number(locations) || ({ two: 2, three: 3, four: 4, five: 5 } as Record<string, number>)[locations.toLowerCase()]
    if (n >= 2) r.siteFacts.push(`${n} locations`)
  }
  const found = r.emails.filter((e) => e.source === 'WEBSITE').length
  r.log.push(`Website ${host}: read ${pages.length} page${pages.length === 1 ? '' : 's'}, ${found ? `found ${found} address${found === 1 ? '' : 'es'}` : 'no email published'}${r.contactFormUrl ? ', has a contact form' : ''}`)
  return domain
}

const CONTACT_DB = /(^|\.)(leadiq\.com|prospeo\.io|rocketreach\.co|zoominfo\.com|apollo\.io|hunter\.io|signalhire\.com|contactout\.com|lusha\.com|datanyze\.com|seamless\.ai|clearbit\.com|crunchbase\.com|email-format\.com|snov\.io|aeroleads\.com|anymailfinder\.com|salesintel\.io|adapt\.io|swordfish\.ai|kaspr\.io|uplead\.com|getprospect\.com|findymail\.com|skrapp\.io|tomba\.io|voilanorbert\.com|emailsherlock\.com|theorg\.com|dnb\.com|6sense\.com|growjo\.com|cience\.com|lead411\.com|contactrocket\.ai|leadfinder\.[a-z]+)$/i

/** Pages elsewhere that mention an address at their domain (directories, chambers, PDFs) */
async function searchEmails(name: string, city: string | undefined, domain: string, country: string | undefined, r: Research) {
  // Serper's free plan rejects any query containing a quoted domain, so the business name leads;
  // Brave allows the sharper "@domain" search
  const queries = [`"${name}"${city ? ` ${city}` : ''} email`, ...(searchProvider() === 'BRAVE' ? [`"@${domain}"`] : [])]
  let calls = 0
  for (const q of queries) {
    if (!(await budgetLeft('search'))) { r.log.push('Web search skipped: daily budget reached'); break }
    try {
      const results = await webSearch(q, country)
      await spend('search')
      calls++
      for (const res of results) {
        const text = `${res.title} ${res.snippet}`
        // Contact databases print a company's email *format* ("j.doe@…"), not a real mailbox
        if (CONTACT_DB.test(hostOf(res.url)) || /email format|email pattern|email address format/i.test(text)) continue
        for (const raw of text.match(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi) || []) {
          const email = normalizeEmail(raw)
          if (!isUsableEmail(email)) continue
          const d = email.split('@')[1]
          const nameHit = text.toLowerCase().includes(name.toLowerCase().slice(0, 18))
          if ((d === domain || d.endsWith(`.${domain}`) || (FREE_MAIL.has(d) && nameHit)) && !r.emails.some((e) => e.email === email)) {
            r.emails.push({ email, source: 'SEARCH', sourceUrl: res.url })
          }
        }
      }
    } catch (err) {
      r.log.push(`Web search failed: ${(err as Error).message}`)
      break
    }
    if (r.emails.length) break // the first query usually does it; save the second
  }
  const n = r.emails.filter((e) => e.source === 'SEARCH').length
  r.log.push(`Web search (${calls} quer${calls === 1 ? 'y' : 'ies'}): ${n ? `found ${n} address${n === 1 ? '' : 'es'} published elsewhere` : 'nothing published elsewhere'}`)
}

/** The owner's name from a search result title ("Jane Doe - Owner - Acme Dental | LinkedIn") */
async function ownerFromSearch(name: string, city: string | undefined, country: string | undefined, r: Research) {
  const core = name.replace(/\b(llc|inc|pllc|dds|dmd|pc|ltd|co|the|of|and|&)\b\.?/gi, '').replace(/[^\w\s'’-]/g, ' ').replace(/\s+/g, ' ').trim()
  if (core.length < 4) return
  if (!(await budgetLeft('search'))) { r.log.push('Owner search skipped: daily web-search budget reached'); return }
  try {
    await spend('search')
    const results = await webSearch(`site:linkedin.com/in "${core}" (owner OR founder OR president OR dentist OR partner)${city ? ` ${city}` : ''}`, country)
    const key = core.toLowerCase().split(' ').filter((w) => w.length > 3)
    for (const res of results) {
      if (!/linkedin\.com\/in\//i.test(res.url)) continue
      const title = res.title.replace(/\s*\|\s*LinkedIn.*$/i, '').replace(/\s*(\.\.\.|…)\s*$/, '')
      const text = `${title} ${res.snippet}`.toLowerCase()
      if (!key.length || !key.every((w) => text.includes(w))) continue
      const parts = title.split(/\s+[-–]\s+/)
      if (!/owner|founder|president|ceo|principal|partner|dds|dmd|director/i.test(`${parts.slice(1).join(' ')} ${res.snippet}`)) continue
      const person = parts[0].replace(/,.*$/, '').trim()
      if (!/^[A-Z][a-zA-Z'’.-]+(\s+[A-Z][a-zA-Z'’.-]+){1,2}$/.test(person)) continue
      r.ownerName = person
      r.ownerTitle = parts[1]?.slice(0, 60) || 'Owner'
      r.ownerSource = 'LinkedIn search result'
      r.linkedIn ||= res.url.split('?')[0]
      r.log.push(`Owner found from a LinkedIn search result: ${person} (${r.ownerTitle})`)
      return
    }
    r.log.push('Owner search: no LinkedIn result that clearly matches this business')
  } catch (err) {
    r.log.push(`Owner search failed: ${(err as Error).message}`)
  }
}

// Directories and profile sites: never a business's own website
const DIRECTORY = /(^|\.)(yelp\.[a-z.]+|yellowpages\.com|mapquest\.com|bbb\.org|healthgrades\.com|zocdoc\.com|webmd\.com|vitals\.com|doximity\.com|npino\.com|npidb\.org|npiprofile\.com|opennpi\.com|hipaaspace\.com|dentistry\.com|1-800-dentist\.com|opencare\.com|ratemds\.com|sharecare\.com|usnews\.com|care\.com|angi\.com|homeadvisor\.com|thumbtack\.com|houzz\.com|nextdoor\.com|manta\.com|chamberofcommerce\.com|superpages\.com|dexknows\.com|citysearch\.com|foursquare\.com|tripadvisor\.[a-z.]+|linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|wikipedia\.org|bizapedia\.com|opencorporates\.com|dnb\.com|zoominfo\.com|crunchbase\.com|indeed\.com|glassdoor\.[a-z.]+|google\.com|bing\.com|apple\.com|amazon\.[a-z.]+|medicare\.gov|[a-z.]+\.gov|birdeye\.com|doctor\.com|wellness\.com|findatopdoc\.com|md\.com)$/i
// Words in a business name that don't identify it
const COMMON_NAME_WORD = /^(dental|dentistry|dentist|family|care|center|centre|clinic|associates|group|office|practice|services?|company|professional|health|medical|smiles?|the|and|of|llc|inc|pllc|dds|dmd|corp|ltd|pa|pc)$/

/**
 * A listing with no website (registry sources never have one): the first search result that is
 * their own domain and carries a distinctive word of their name. A wrong site would mean a
 * wrong email, so when nothing clearly matches we return nothing.
 */
const FOREIGN_TLD = /\.(uk|wales|scot|cymru|ie|au|nz|ca|in|za|sg|de|fr|es|it|nl|eu)$/i

async function findWebsite(b: { name: string; city?: string | null; state?: string | null; country?: string | null; ownerName?: string | null }, r: Research) {
  const tokens = b.name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !COMMON_NAME_WORD.test(w))
  if (!tokens.length) { r.log.push('Website search skipped: the name is too generic to match a site safely'); return '' }
  if (!(await budgetLeft('search'))) { r.deferred = true; r.log.push('Website search waiting: daily web-search budget reached, tried again tomorrow'); return '' }
  try {
    await spend('search')
    const results = await webSearch(`${b.name} ${[b.city, b.state].filter(Boolean).join(' ')}`.trim(), b.country)
    const city = (b.city || '').toLowerCase()
    const ownerLast = splitName(b.ownerName || undefined).last.toLowerCase().replace(/[^a-z]/g, '')
    for (const res of results.slice(0, 6)) {
      const host = hostOf(res.url)
      if (!host || DIRECTORY.test(host) || !ownDomain(res.url)) continue
      if ((!b.country || b.country.toUpperCase() === 'US') && FOREIGN_TLD.test(host)) continue
      const flat = host.replace(/[^a-z0-9]/g, '')
      const title = res.title.toLowerCase()
      const inHost = tokens.filter((t) => flat.includes(t)).length
      const local = !!city && `${title} ${res.snippet.toLowerCase()}`.includes(city)
      // The domain itself must carry their name (all of it, or part of it on a page about their
      // city), or the owner's surname; failing that, the title must carry the whole name and the city
      const ok = inHost === tokens.length
        || (inHost >= 1 && local)
        || (ownerLast.length > 3 && flat.includes(ownerLast) && local)
        || (tokens.length >= 2 && tokens.every((t) => title.includes(t)) && local)
      if (ok) {
        r.log.push(`No website on the listing: found ${host} by web search`)
        return `https://${host}`
      }
    }
    r.log.push('No website on the listing, and web search found no site that clearly belongs to them')
  } catch (err) {
    if (err instanceof NoKeyError) r.deferred = true
    r.log.push(`Website search failed: ${(err as Error).message}`)
  }
  return ''
}

function splitName(full?: string) {
  const parts = (full || '').replace(/^Dr\.?\s+/i, '').replace(/,.*$/, '').trim().split(/\s+/)
  return { first: parts[0] || '', last: parts.length > 1 ? parts[parts.length - 1] : '' }
}

let hunterCredits: { at: number; left: number } | null = null
async function hunterCreditsLeft() {
  if (hunterCredits && Date.now() - hunterCredits.at < 60_000) return hunterCredits.left
  const left = (await hunterAccount().catch(() => null))?.remaining ?? 0
  hunterCredits = { at: Date.now(), left }
  return left
}
function spendHunter(n: number) { if (hunterCredits) hunterCredits.left -= n }

/** The whole waterfall for one business */
export async function researchBusiness(b: {
  name: string; website?: string | null; city?: string | null; state?: string | null; country?: string | null; ownerName?: string | null; listingEmail?: string | null
}, niche: Niche | null, s: FinderSettings, deadline: number): Promise<Research> {
  const r: Research = { emails: [], techSignals: [], siteFacts: [], log: [] }
  if (b.ownerName) { r.ownerName = b.ownerName }
  const country = b.country || undefined

  // 1. Listing
  if (b.listingEmail) {
    const email = normalizeEmail(b.listingEmail)
    if (isUsableEmail(email)) { r.emails.push({ email, source: 'LISTING' }); r.log.push(`Listing: ${email}`) }
  }

  // 2. Website
  let domain = ''
  const host = b.website ? hostOf(b.website) : ''
  if (!b.website) {
    const site = s.useWebSearch && searchProvider() && deadline - Date.now() > 12_000 ? await findWebsite(b, r) : ''
    if (site) {
      r.website = site
      domain = await researchWebsite(site, niche, r, deadline)
      domain ||= ownDomain(site)
    } else if (!r.log.length || !/website/i.test(r.log[r.log.length - 1])) r.log.push('No website on the listing')
  } else if (SOCIAL_SITE.test(host)) {
    r.log.push(`"Website" is a ${host} page, not their own site`)
    if (/facebook|fb\.com/.test(host)) r.facebook = b.website
  } else {
    domain = await researchWebsite(b.website, niche, r, deadline)
    domain ||= ownDomain(b.website)
  }

  const hasOwnDomainEmail = () => r.emails.some((e) => domain && e.email.endsWith(`@${domain}`))
  const hasPersonal = () => r.emails.some((e) => !emailTraits(e.email).isRole)

  // 3. Published elsewhere
  if (!hasOwnDomainEmail() && domain && s.useWebSearch && searchProvider() && deadline - Date.now() > 8_000) {
    await searchEmails(b.name, b.city || undefined, domain, country, r)
  }

  // 4. Owner's name (for a personal address and a personal greeting)
  if (!r.ownerName && s.useWebSearch && searchProvider() && domain && !hasPersonal() && deadline - Date.now() > 8_000) {
    await ownerFromSearch(b.name, b.city || undefined, country, r)
  }

  // 5. Email finders, only when nothing usable came from free sources
  const reserve = (await getAudienceSettings()).hunterReserve
  if (s.useHunter && finderProviders().length && domain && !r.emails.length && deadline - Date.now() > 8_000) {
    // Hunter keeps its credit reserve; the other finders have their own free allowances
    const hunterOk = hunterConfigured() && await hunterCreditsLeft() > reserve
    if (hunterConfigured() && !hunterOk) r.log.push(`Hunter skipped: credits at the reserve (${reserve})`)
    if (hunterOk || finderProviders().some((f) => f !== 'HUNTER')) {
      const { first, last } = splitName(r.ownerName)
      const res = await findBusinessEmail({ firstName: first || null, lastName: last || null, website: `https://${domain}`, company: b.name }, { hunter: hunterOk })
      if (res.found?.source === 'HUNTER') spendHunter(1)
      if (res.found) r.emails.push({ email: res.found.email, source: res.found.source, sourceUrl: res.found.sourceUrl, confidence: res.found.confidence, status: res.found.status, verifyMethod: res.found.status === 'VERIFIED' ? res.found.source : undefined, verifyDetail: res.found.detail })
      r.log.push(...res.notes.map((n) => `Email finders: ${n}`))
    }
  }

  // 6. Guesses, confirmed or thrown away
  if (s.guessEmails && domain && !r.emails.length && deadline - Date.now() > 8_000) {
    const { first, last } = splitName(r.ownerName)
    const guesses = [
      ...(first ? patternGuesses(first, last || undefined, domain).slice(0, 2).map((email) => ({ email, source: 'PATTERN' as const })) : []),
      ...(first && last && niche?.group === 'Health' ? [{ email: `dr${last.toLowerCase().replace(/[^a-z]/g, '')}@${domain}`, source: 'PATTERN' as const }] : []),
      ...(niche?.roleGuesses || ['info', 'office', 'contact']).slice(0, 3).map((l) => ({ email: `${l}@${domain}`, source: 'ROLE_GUESS' as const })),
    ]
    if (verifierProvider()) {
      let kept = 0
      for (const g of guesses) {
        if (deadline - Date.now() < 4_000) break
        const v = await verifyEmail(g.email)
        if (v.status === 'VERIFIED') { r.emails.push({ ...g, status: 'VERIFIED', verifyMethod: v.method, verifyDetail: v.detail, confidence: 80 }); kept++; if (g.source === 'PATTERN') break }
        if (v.method === 'MX' && v.status === 'INVALID') break // domain can't receive mail at all
      }
      r.log.push(`Guessed ${guesses.length} likely addresses, ${kept} confirmed by the verifier`)
    } else if (s.useHunter && hunterConfigured() && (await hunterCreditsLeft()) > reserve + 1) {
      // No verifier: one Hunter check (half a credit) on the most likely inbox, only if Hunter has seen mail at this domain
      const count = await hunterEmailCount(domain).catch(() => ({ total: 0 }))
      if (count.total > 0) {
        const g = guesses.find((x) => x.source === 'ROLE_GUESS') || guesses[0]
        const v = await verifyWithHunter(g.email)
        spendHunter(0.5)
        if (v.status === 'VERIFIED') r.emails.push({ ...g, status: 'VERIFIED', verifyMethod: v.method, verifyDetail: v.detail, confidence: 75 })
        r.log.push(`Checked ${g.email} with Hunter: ${v.status.toLowerCase()}`)
      } else r.log.push('Guessing skipped: no verifier key, and Hunter has never seen mail at this domain')
    } else r.log.push('Guessing skipped: add a verifier key (ZeroBounce, MillionVerifier, NeverBounce or Reoon) to confirm guessed addresses')
  }

  // Verify whatever is still unchecked (MX always; mailbox check with a verifier key)
  for (const e of r.emails) {
    if (e.status && e.verifyMethod) continue
    if (deadline - Date.now() < 3_000) break
    const v = await verifyEmail(e.email)
    e.status = v.status; e.verifyMethod = v.method; e.verifyDetail = v.detail
  }
  if (!r.emails.length) r.log.push(r.phone || r.contactFormUrl ? 'No email anywhere: use the phone or contact form' : 'No email anywhere')
  return r
}
