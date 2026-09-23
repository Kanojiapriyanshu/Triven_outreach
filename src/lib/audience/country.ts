// Where is this person? YouTube and Hacker News don't expose a commenter's country, so it is
// inferred from every signal we have, each with a confidence. The strongest wins; two
// independent signals that agree raise the confidence. Browser-safe, pure.
import { countryFromDomain, COUNTRIES } from './taxonomy'

export type CountrySource = 'MANUAL' | 'HUNTER' | 'CHANNEL' | 'LOCATION' | 'LINKEDIN' | 'PHONE' | 'TEXT' | 'CURRENCY' | 'DOMAIN'

export interface CountryGuess { country: string; source: CountrySource; confidence: number }

const BASE: Record<CountrySource, number> = {
  MANUAL: 100, HUNTER: 85, CHANNEL: 80, LOCATION: 75, LINKEDIN: 70, PHONE: 65, TEXT: 55, CURRENCY: 45, DOMAIN: 60,
}

// Country names, demonyms and common short forms
const NAMES: Array<[RegExp, string]> = [
  [/\b(united states|u\.s\.a?\.?|usa|america(?!n express))\b/i, 'US'], [/\bamerican\b/i, 'US'],
  [/\b(united kingdom|u\.k\.|uk|england|scotland|wales|britain|british)\b/i, 'GB'],
  [/\b(canada|canadian)\b/i, 'CA'], [/\b(australia|australian|aussie)\b/i, 'AU'], [/\b(new zealand|kiwi)\b/i, 'NZ'],
  [/\b(ireland|irish)\b/i, 'IE'], [/\b(india|indian)\b/i, 'IN'], [/\b(pakistan|pakistani)\b/i, 'PK'],
  [/\b(bangladesh|bangladeshi)\b/i, 'BD'], [/\b(sri lanka|sri lankan)\b/i, 'LK'], [/\b(nepal|nepali)\b/i, 'NP'],
  [/\b(singapore|singaporean)\b/i, 'SG'], [/\b(malaysia|malaysian)\b/i, 'MY'], [/\b(philippines|filipino|pinoy)\b/i, 'PH'],
  [/\b(south africa|south african)\b/i, 'ZA'], [/\b(nigeria|nigerian)\b/i, 'NG'], [/\b(kenya|kenyan)\b/i, 'KE'],
  [/\b(ghana|ghanaian)\b/i, 'GH'], [/\b(uganda|ugandan)\b/i, 'UG'], [/\b(uae|emirates|dubai)\b/i, 'AE'],
  [/\b(germany|german)\b/i, 'DE'], [/\b(netherlands|dutch)\b/i, 'NL'], [/\b(france|french)\b/i, 'FR'],
  [/\b(spain|spanish)\b/i, 'ES'], [/\b(italy|italian)\b/i, 'IT'], [/\b(sweden|swedish)\b/i, 'SE'],
  [/\b(brazil|brazilian)\b/i, 'BR'], [/\b(mexico|mexican)\b/i, 'MX'], [/\b(israel|israeli)\b/i, 'IL'],
]

const CITIES: Record<string, string> = {
  'new york': 'US', nyc: 'US', 'san francisco': 'US', 'bay area': 'US', 'los angeles': 'US', chicago: 'US', austin: 'US',
  seattle: 'US', boston: 'US', miami: 'US', dallas: 'US', houston: 'US', denver: 'US', atlanta: 'US',
  london: 'GB', manchester: 'GB', birmingham: 'GB', edinburgh: 'GB', glasgow: 'GB', bristol: 'GB', leeds: 'GB',
  toronto: 'CA', vancouver: 'CA', montreal: 'CA', calgary: 'CA', ottawa: 'CA',
  sydney: 'AU', melbourne: 'AU', brisbane: 'AU', perth: 'AU', adelaide: 'AU',
  auckland: 'NZ', wellington: 'NZ', dublin: 'IE', cork: 'IE',
  mumbai: 'IN', bangalore: 'IN', bengaluru: 'IN', delhi: 'IN', 'new delhi': 'IN', hyderabad: 'IN', chennai: 'IN', pune: 'IN', kolkata: 'IN', noida: 'IN', gurgaon: 'IN', gurugram: 'IN', ahmedabad: 'IN',
  karachi: 'PK', lahore: 'PK', islamabad: 'PK', dhaka: 'BD', colombo: 'LK', kathmandu: 'NP',
  'kuala lumpur': 'MY', manila: 'PH', cebu: 'PH', lagos: 'NG', abuja: 'NG', nairobi: 'KE', accra: 'GH', kampala: 'UG',
  johannesburg: 'ZA', 'cape town': 'ZA', durban: 'ZA', 'abu dhabi': 'AE', berlin: 'DE', munich: 'DE', amsterdam: 'NL', paris: 'FR',
}
const CITY_RE = new RegExp(`\\b(${Object.keys(CITIES).map((c) => c.replace(/ /g, '\\s+')).join('|')})\\b`, 'i')

// "from India", "based in London", "here in Australia", "I'm in the UK"
// The phrase may start a sentence; the place itself must be capitalised
const PLACE_CONTEXT = /\b(?:[Ff]rom|[Bb]ased in|[Bb]ased out of|[Ll]iving in|[Ll]ive in|[Hh]ere in|I'?m in|[Ww]e'?re in|[Ll]ocated in|[Ii]n the)\s+((?:the\s+)?[A-Z][\w.]+(?:\s+[A-Z][\w.]+)?)/g

const PHONE: Array<[RegExp, string]> = [
  [/\+44\s?\d/, 'GB'], [/\+61\s?\d/, 'AU'], [/\+91[\s-]?\d/, 'IN'], [/\+64\s?\d/, 'NZ'], [/\+353\s?\d/, 'IE'],
  [/\+65\s?\d/, 'SG'], [/\+971\s?\d/, 'AE'], [/\+234\s?\d/, 'NG'], [/\+254\s?\d/, 'KE'], [/\+27\s?\d/, 'ZA'],
  [/\+92\s?\d/, 'PK'], [/\+63\s?\d/, 'PH'], [/\+60\s?\d/, 'MY'], [/\+233\s?\d/, 'GH'], [/\+880\s?\d/, 'BD'], [/\+1[\s-(]?\d{3}/, 'US'],
]

const CURRENCY: Array<[RegExp, string]> = [
  [/₹|\bINR\b|\blakhs?\b|\bcrores?\b|\brupees?\b/i, 'IN'], [/£|\bGBP\b|\bquid\b/i, 'GB'], [/\bA\$|\bAUD\b/, 'AU'],
  [/\bC\$|\bCAD\b/, 'CA'], [/\bNZ\$|\bNZD\b/, 'NZ'], [/₦|\bnaira\b|\bNGN\b/i, 'NG'], [/\bAED\b|\bdirhams?\b/i, 'AE'],
  [/\bKES\b|\bKsh\b/, 'KE'], [/\bPKR\b/, 'PK'], [/\bZAR\b/, 'ZA'], [/\bS\$|\bSGD\b/, 'SG'], [/₱/, 'PH'], // not "PHP": that's usually the programming language
]

// LinkedIn's country subdomains: uk.linkedin.com, in.linkedin.com …
const LI_SUB: Record<string, string> = { uk: 'GB', in: 'IN', ca: 'CA', au: 'AU', nz: 'NZ', ie: 'IE', sg: 'SG', za: 'ZA', ae: 'AE', ng: 'NG', ke: 'KE', pk: 'PK', ph: 'PH', my: 'MY', gh: 'GH', de: 'DE', nl: 'NL', fr: 'FR', es: 'ES', it: 'IT', se: 'SE', br: 'BR', mx: 'MX', il: 'IL', bd: 'BD', lk: 'LK', np: 'NP' }

function fromPlaceText(text: string) {
  const city = text.match(CITY_RE)?.[1]
  if (city) return CITIES[city.toLowerCase().replace(/\s+/g, ' ')]
  for (const [re, code] of NAMES) if (re.test(text)) return code
  return null
}

/** Free text written by the person: bio, comments, "about" */
function fromText(text: string): string | null {
  for (const m of text.matchAll(PLACE_CONTEXT)) {
    const c = fromPlaceText(m[1])
    if (c) return c
  }
  const city = text.match(CITY_RE)?.[1]
  if (city) return CITIES[city.toLowerCase().replace(/\s+/g, ' ')]
  return null
}

export function inferCountry(s: {
  existing?: { country?: string | null; source?: string | null; confidence?: number | null }
  channelCountry?: string | null
  location?: string | null
  linkedIn?: string | null
  website?: string | null
  texts?: string[]
}): CountryGuess | null {
  const guesses: CountryGuess[] = []
  const add = (country: string | null | undefined, source: CountrySource, confidence = BASE[source]) => {
    if (country) guesses.push({ country: country.toUpperCase(), source, confidence })
  }
  if (s.existing?.country && s.existing.source) add(s.existing.country, s.existing.source as CountrySource, s.existing.confidence || BASE[s.existing.source as CountrySource] || 50)
  add(s.channelCountry, 'CHANNEL')
  if (s.location) add(fromPlaceText(s.location), 'LOCATION')
  const sub = s.linkedIn?.match(/^https?:\/\/([a-z]{2})\.linkedin\.com/i)?.[1]?.toLowerCase()
  if (sub && sub !== 'www') add(LI_SUB[sub], 'LINKEDIN')
  add(countryFromDomain(s.website), 'DOMAIN')
  const text = (s.texts || []).filter(Boolean).join('\n')
  if (text) {
    for (const [re, code] of PHONE) if (re.test(text)) { add(code, 'PHONE'); break }
    add(fromText(text), 'TEXT')
    for (const [re, code] of CURRENCY) if (re.test(text)) { add(code, 'CURRENCY'); break }
  }
  if (!guesses.length) return null

  // Sum confidence per country: agreement between independent signals is strong evidence
  const byCountry = new Map<string, { best: CountryGuess; sources: Set<string> }>()
  for (const g of guesses) {
    const cur = byCountry.get(g.country)
    if (!cur) byCountry.set(g.country, { best: g, sources: new Set([g.source]) })
    else {
      cur.sources.add(g.source)
      if (g.confidence > cur.best.confidence) cur.best = g
    }
  }
  const ranked = [...byCountry.values()].map((v) => ({
    ...v.best,
    confidence: Math.min(99, v.best.confidence + (v.sources.size - 1) * 10),
  })).sort((a, b) => b.confidence - a.confidence)
  return ranked[0]
}

export function countryLabel(code?: string | null) {
  return code ? COUNTRIES[code]?.name || code : ''
}

/** 🇮🇳 from "IN" */
export function flag(code?: string | null) {
  if (!code || !/^[A-Z]{2}$/i.test(code)) return ''
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}
