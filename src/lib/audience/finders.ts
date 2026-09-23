// Email-finder APIs: licensed B2B contact data, queried only for people whose identity we
// already confirmed (name + company domain or LinkedIn URL). One waterfall per person.
import { hostOf, SHARED_HOSTS } from './enrich'
import { FREE_MAIL, normalizeEmail, isUsableEmail } from './verify'
import type { EmailStatus } from './taxonomy'

export interface FoundEmail {
  email: string
  source: 'HUNTER' | 'APOLLO'
  confidence: number
  status: EmailStatus
  detail: string
  sourceUrl?: string
}

export function finderProviders() {
  return [process.env.HUNTER_API_KEY && 'HUNTER', process.env.APOLLO_API_KEY && 'APOLLO'].filter(Boolean) as Array<'HUNTER' | 'APOLLO'>
}

/** The person's own company domain, if we have one worth asking about */
export function companyDomain(website?: string | null) {
  const host = website ? hostOf(website) : ''
  if (!host || SHARED_HOSTS.test(host) || FREE_MAIL.has(host)) return ''
  return host
}

async function hunterFind(q: { domain?: string; first?: string; last?: string; linkedIn?: string; company?: string }): Promise<FoundEmail | null> {
  const key = process.env.HUNTER_API_KEY
  if (!key) return null
  const params = new URLSearchParams({ api_key: key })
  const handle = q.linkedIn?.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1]
  if (q.domain) params.set('domain', q.domain)
  else if (q.company) params.set('company', q.company)
  if (q.first && q.last) { params.set('first_name', q.first); params.set('last_name', q.last) }
  else if (handle) params.set('linkedin_handle', handle)
  else return null
  if (!params.has('domain') && !params.has('company') && !params.has('linkedin_handle')) return null

  const res = await fetch(`https://api.hunter.io/v2/email-finder?${params}`, { signal: AbortSignal.timeout(20_000), cache: 'no-store' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Hunter HTTP ${res.status}`)
  const d = await res.json() as { data?: { email?: string | null; score?: number; type?: string; verification?: { status?: string | null } } }
  const email = d.data?.email ? normalizeEmail(d.data.email) : ''
  if (!email || !isUsableEmail(email)) return null
  const v = d.data?.verification?.status || ''
  return {
    email, source: 'HUNTER', confidence: d.data?.score || 0,
    status: v === 'valid' ? 'VERIFIED' : v === 'accept_all' ? 'RISKY' : 'UNKNOWN',
    detail: `Hunter ${d.data?.type || ''} match, score ${d.data?.score ?? '?'}${v ? `, ${v}` : ''}`,
    sourceUrl: q.domain ? `https://${q.domain}` : undefined,
  }
}

/** No name? Ask Hunter who at the domain is the decision maker (small agencies: the owner) */
async function hunterDomainOwner(domain: string): Promise<FoundEmail | null> {
  const key = process.env.HUNTER_API_KEY
  if (!key) return null
  const res = await fetch(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${key}`, { signal: AbortSignal.timeout(20_000), cache: 'no-store' })
  if (!res.ok) return null
  const d = await res.json() as { data?: { emails?: Array<{ value: string; type: string; confidence: number; position?: string | null; verification?: { status?: string | null } }> } }
  const emails = d.data?.emails || []
  const pick = emails.find((e) => e.type === 'personal' && /founder|owner|ceo|director|partner|principal|president/i.test(e.position || ''))
    || (emails.length <= 3 ? emails.sort((a, b) => b.confidence - a.confidence)[0] : undefined)
  if (!pick) return null
  const v = pick.verification?.status || ''
  return {
    email: normalizeEmail(pick.value), source: 'HUNTER', confidence: pick.confidence,
    status: v === 'valid' ? 'VERIFIED' : v === 'accept_all' ? 'RISKY' : 'UNKNOWN',
    detail: `Hunter domain search: ${pick.position || pick.type}, confidence ${pick.confidence}`,
    sourceUrl: `https://${domain}`,
  }
}

async function apolloMatch(q: { first?: string; last?: string; domain?: string; linkedIn?: string; company?: string }): Promise<FoundEmail | null> {
  const key = process.env.APOLLO_API_KEY
  if (!key) return null
  if (!q.linkedIn && !(q.first && q.last && (q.domain || q.company))) return null
  const body: Record<string, unknown> = { reveal_personal_emails: false }
  if (q.first) body.first_name = q.first
  if (q.last) body.last_name = q.last
  if (q.domain) body.domain = q.domain
  else if (q.company) body.organization_name = q.company
  if (q.linkedIn) body.linkedin_url = q.linkedIn
  const res = await fetch('https://api.apollo.io/api/v1/people/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'x-api-key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000), cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Apollo HTTP ${res.status}`)
  const d = await res.json() as { person?: { email?: string | null; email_status?: string | null; match_confidence?: string; title?: string } | null }
  const email = d.person?.email ? normalizeEmail(d.person.email) : ''
  if (!email || !isUsableEmail(email) || /email_not_unlocked|domain\.com$/.test(email)) return null
  const conf = d.person?.match_confidence === 'high' ? 90 : d.person?.match_confidence === 'medium' ? 70 : 50
  return {
    email, source: 'APOLLO', confidence: conf,
    status: d.person?.email_status === 'verified' ? 'VERIFIED' : 'UNKNOWN',
    detail: `Apollo ${d.person?.match_confidence || ''} match${d.person?.title ? ` (${d.person.title})` : ''}, ${d.person?.email_status || 'unverified'}`,
  }
}

/** Waterfall: Hunter by name → Apollo → Hunter domain owner. Stops at the first address found. */
export async function findBusinessEmail(p: { firstName?: string | null; lastName?: string | null; website?: string | null; linkedIn?: string | null; company?: string | null }) {
  const domain = companyDomain(p.website)
  const q = { first: p.firstName || undefined, last: p.lastName || undefined, domain: domain || undefined, linkedIn: p.linkedIn || undefined, company: p.company || undefined }
  const notes: string[] = []
  for (const step of [
    { name: 'Hunter', key: 'HUNTER_API_KEY', run: () => hunterFind(q) },
    { name: 'Apollo', key: 'APOLLO_API_KEY', run: () => apolloMatch(q) },
    { name: 'Hunter domain', key: 'HUNTER_API_KEY', run: () => (domain && !(q.first && q.last) ? hunterDomainOwner(domain) : Promise.resolve(null)) },
  ].filter((s) => process.env[s.key])) {
    try {
      const found = await step.run()
      if (found) return { found, notes: [...notes, `${step.name}: ${found.email}`] }
      notes.push(`${step.name}: no match`)
    } catch (err) {
      notes.push(`${step.name}: ${(err as Error).message}`)
    }
  }
  return { found: null, notes }
}
