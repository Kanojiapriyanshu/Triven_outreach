// Hunter.io, credit-aware. Free endpoints (account, email-count) are used to avoid wasting
// paid calls; paid ones (email-finder, domain-search, combined enrichment) only run while the
// account has more credits left than the reserve set in Audience → Rules.
import { normalizeEmail, isUsableEmail } from './verify'
import type { EmailStatus } from './taxonomy'

const API = 'https://api.hunter.io/v2'

export function hunterConfigured() {
  return !!process.env.HUNTER_API_KEY
}

async function get<T>(path: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ ...params, api_key: process.env.HUNTER_API_KEY || '' })
  const res = await fetch(`${API}/${path}?${qs}`, { signal: AbortSignal.timeout(20_000), cache: 'no-store' })
  if (res.status === 404) return null
  const body = await res.json().catch(() => ({})) as { data?: T; errors?: Array<{ details?: string; id?: string }> }
  if (res.status === 429 || res.status === 403) throw new HunterLimitError(body.errors?.[0]?.details || 'Hunter credits or rate limit reached')
  if (!res.ok) throw new Error(`Hunter ${path}: ${body.errors?.[0]?.details || `HTTP ${res.status}`}`)
  return body.data ?? null
}

export class HunterLimitError extends Error {}

// ─── Free ────────────────────────────────────────────────────────────────────

export interface HunterAccount { plan: string; remaining: number; available: number; resetDate: string | null }

/** Credits left this month (free call) */
export async function hunterAccount(): Promise<HunterAccount | null> {
  if (!hunterConfigured()) return null
  const d = await get<{ plan_name?: string; reset_date?: string; requests?: { credits?: { available?: number; remaining?: number } } }>('account', {})
  if (!d) return null
  return {
    plan: d.plan_name || '',
    remaining: Math.floor(d.requests?.credits?.remaining ?? 0),
    available: Math.floor(d.requests?.credits?.available ?? 0),
    resetDate: d.reset_date || null,
  }
}

/** How many addresses Hunter knows at a domain (free). 0 = don't spend a credit there. */
export async function hunterEmailCount(domain: string) {
  const d = await get<{ total?: number; personal_emails?: number; generic_emails?: number }>('email-count', { domain })
  return { total: d?.total ?? 0, personal: d?.personal_emails ?? 0, generic: d?.generic_emails ?? 0 }
}

// ─── Paid (1 credit each when something is found) ───────────────────────────

export interface HunterEmail { email: string; confidence: number; status: EmailStatus; detail: string; sourceUrl?: string }

function status(v?: string | null): EmailStatus {
  return v === 'valid' ? 'VERIFIED' : v === 'accept_all' ? 'RISKY' : v === 'invalid' ? 'INVALID' : 'UNKNOWN'
}

/** Email of a named person at a company domain (or via their LinkedIn handle) */
export async function hunterFindEmail(q: { domain?: string; company?: string; first?: string; last?: string; linkedIn?: string }): Promise<HunterEmail | null> {
  const params: Record<string, string> = {}
  const handle = q.linkedIn?.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1]
  if (q.domain) params.domain = q.domain
  else if (q.company) params.company = q.company
  if (q.first && q.last) { params.first_name = q.first; params.last_name = q.last }
  else if (handle) params.linkedin_handle = handle
  else return null
  if (!params.domain && !params.company && !params.linkedin_handle) return null

  const d = await get<{ email?: string | null; score?: number; type?: string; position?: string | null; verification?: { status?: string | null } }>('email-finder', params)
  const email = d?.email ? normalizeEmail(d.email) : ''
  if (!email || !isUsableEmail(email)) return null
  return {
    email, confidence: d?.score || 0, status: status(d?.verification?.status),
    detail: `Hunter ${d?.type ? `${d.type} ` : ''}match, score ${d?.score ?? '?'}${d?.verification?.status ? `, ${d.verification.status}` : ''}`,
    sourceUrl: q.domain ? `https://${q.domain}` : undefined,
  }
}

/** No name? The decision maker at a small company's domain (founder / owner / CEO) */
export async function hunterDomainOwner(domain: string): Promise<HunterEmail | null> {
  const d = await get<{ emails?: Array<{ value: string; type: string; confidence: number; position?: string | null; first_name?: string | null; last_name?: string | null; verification?: { status?: string | null } }> }>(
    'domain-search', { domain, limit: '10' })
  const emails = d?.emails || []
  const pick = emails.find((e) => e.type === 'personal' && /founder|owner|ceo|director|partner|principal|president/i.test(e.position || ''))
    || (emails.length <= 3 ? [...emails].sort((a, b) => b.confidence - a.confidence)[0] : undefined)
  if (!pick) return null
  return {
    email: normalizeEmail(pick.value), confidence: pick.confidence, status: status(pick.verification?.status),
    detail: `Hunter domain search: ${[pick.first_name, pick.last_name].filter(Boolean).join(' ') || pick.type}${pick.position ? `, ${pick.position}` : ''}, confidence ${pick.confidence}`,
    sourceUrl: `https://${domain}`,
  }
}

export interface HunterPerson {
  firstName?: string; lastName?: string; title?: string; companyDomain?: string; companyName?: string
  linkedIn?: string; twitter?: string; city?: string; country?: string
}

/** Who owns this address? Name, job, company and LinkedIn from one email (combined enrichment) */
export async function hunterEnrich(email: string): Promise<HunterPerson | null> {
  const d = await get<{
    person?: {
      name?: { givenName?: string | null; familyName?: string | null }
      employment?: { domain?: string | null; name?: string | null; title?: string | null }
      linkedin?: { handle?: string | null }; twitter?: { handle?: string | null }
      geo?: { city?: string | null; country?: string | null; countryCode?: string | null }
    } | null
    company?: { name?: string | null; domain?: string | null } | null
  }>('combined/find', { email })
  if (!d?.person && !d?.company) return null
  const p = d.person || {}
  const handle = p.linkedin?.handle?.replace(/^\/?(in\/)?/, '')
  return {
    firstName: p.name?.givenName || undefined,
    lastName: p.name?.familyName || undefined,
    title: p.employment?.title || undefined,
    companyDomain: p.employment?.domain || d.company?.domain || undefined,
    companyName: d.company?.name || p.employment?.name || undefined,
    linkedIn: handle ? `https://www.linkedin.com/in/${handle}` : undefined,
    twitter: p.twitter?.handle ? `https://x.com/${p.twitter.handle}` : undefined,
    city: p.geo?.city || undefined,
    country: p.geo?.countryCode || undefined,
  }
}
