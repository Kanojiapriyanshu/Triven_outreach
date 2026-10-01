// Email-finder APIs: licensed B2B contact data, queried only for people whose identity we
// already confirmed (name + company domain or LinkedIn URL). One waterfall per person.
import { hostOf, SHARED_HOSTS } from './enrich'
import { FREE_MAIL, normalizeEmail, isUsableEmail } from './verify'
import { hunterConfigured, hunterEmailCount, hunterFindEmail, hunterDomainOwner, HunterLimitError } from './hunter'
import type { EmailStatus } from './taxonomy'
import { budgetLeft, spend } from '../budget'
import { configured, withKey, rejection, NoKeyError } from '../providers/keys'
import { prospeoFindEmail, tombaDomainOwner, tombaFindEmail } from '../providers/email-finders'

export type FinderSource = 'HUNTER' | 'APOLLO' | 'TOMBA' | 'PROSPEO'

export interface FoundEmail {
  email: string
  source: FinderSource
  confidence: number
  status: EmailStatus
  detail: string
  sourceUrl?: string
}

export function finderProviders() {
  return [hunterConfigured() && 'HUNTER', configured('apollo') && 'APOLLO', configured('prospeo') && 'PROSPEO', configured('tomba') && 'TOMBA'].filter(Boolean) as FinderSource[]
}

/** The person's own company domain, if we have one worth asking about */
export function companyDomain(website?: string | null) {
  const host = website ? hostOf(website) : ''
  if (!host || SHARED_HOSTS.test(host) || FREE_MAIL.has(host)) return ''
  return host
}

async function apolloMatch(q: { first?: string; last?: string; domain?: string; linkedIn?: string; company?: string }): Promise<FoundEmail | null> {
  if (!q.linkedIn && !(q.first && q.last && (q.domain || q.company))) return null
  const body: Record<string, unknown> = { reveal_personal_emails: false }
  if (q.first) body.first_name = q.first
  if (q.last) body.last_name = q.last
  if (q.domain) body.domain = q.domain
  else if (q.company) body.organization_name = q.company
  if (q.linkedIn) body.linkedin_url = q.linkedIn
  const d = await withKey('apollo', async (key) => {
    const res = await fetch('https://api.apollo.io/api/v1/people/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'x-api-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000), cache: 'no-store',
    })
    if (!res.ok) throw rejection(res.status, await res.text().catch(() => '')) || new Error(`Apollo HTTP ${res.status}`)
    return await res.json() as { person?: { email?: string | null; email_status?: string | null; match_confidence?: string; title?: string } | null }
  })
  const email = d.person?.email ? normalizeEmail(d.person.email) : ''
  if (!email || !isUsableEmail(email) || /email_not_unlocked|domain\.com$/.test(email)) return null
  const conf = d.person?.match_confidence === 'high' ? 90 : d.person?.match_confidence === 'medium' ? 70 : 50
  return {
    email, source: 'APOLLO', confidence: conf,
    status: d.person?.email_status === 'verified' ? 'VERIFIED' : 'UNKNOWN',
    detail: `Apollo ${d.person?.match_confidence || ''} match${d.person?.title ? ` (${d.person.title})` : ''}, ${d.person?.email_status || 'unverified'}`,
  }
}

/**
 * Waterfall: by name (Hunter → Apollo → Prospeo → Tomba), then the owner at the domain
 * (Hunter → Tomba). Stops at the first address found; a provider whose keys are used up is skipped.
 * A free Hunter email-count check runs first so no credit is spent on domains Hunter knows nothing about.
 */
export async function findBusinessEmail(p: { firstName?: string | null; lastName?: string | null; website?: string | null; linkedIn?: string | null; company?: string | null }, opts: { hunter?: boolean } = {}) {
  const useHunter = hunterConfigured() && opts.hunter !== false
  const domain = companyDomain(p.website)
  const q = { first: p.firstName || undefined, last: p.lastName || undefined, domain: domain || undefined, linkedIn: p.linkedIn || undefined, company: p.company || undefined }
  const notes: string[] = []
  let outOfCredits = false

  let hunterHasData = true
  if (useHunter && domain) {
    try {
      const count = await hunterEmailCount(domain)
      hunterHasData = count.total > 0
      notes.push(`Hunter knows ${count.total} address${count.total === 1 ? '' : 'es'} at ${domain} (free check)`)
    } catch { /* fall through and try anyway */ }
  }

  const hunterStep = async <T>(run: () => Promise<T>) => {
    try { return await run() } catch (err) {
      if (err instanceof HunterLimitError) outOfCredits = true
      throw err
    }
  }
  const steps: Array<{ name: string; enabled: boolean; run: () => Promise<FoundEmail | null> }> = [
    {
      name: 'Hunter',
      enabled: useHunter && (!domain || hunterHasData),
      run: async () => { const r = await hunterStep(() => hunterFindEmail(q)); return r && { ...r, source: 'HUNTER' as const } },
    },
    { name: 'Apollo', enabled: configured('apollo'), run: () => apolloMatch(q) },
    { name: 'Prospeo', enabled: configured('prospeo') && !!(q.linkedIn || (q.first && q.last)), run: async () => { const r = await prospeoFindEmail(q); return r && { ...r, source: 'PROSPEO' as const } } },
    { name: 'Tomba', enabled: configured('tomba') && !!(domain && q.first && q.last), run: async () => { const r = await tombaFindEmail(q); return r && { ...r, source: 'TOMBA' as const } } },
    {
      name: 'Hunter domain',
      enabled: useHunter && !!domain && hunterHasData && !(q.first && q.last),
      run: async () => { const r = await hunterStep(() => hunterDomainOwner(domain)); return r && { ...r, source: 'HUNTER' as const } },
    },
    { name: 'Tomba domain', enabled: configured('tomba') && !!domain && !(q.first && q.last), run: async () => { const r = await tombaDomainOwner(domain); return r && { ...r, source: 'TOMBA' as const } } },
  ]
  for (const step of steps.filter((s) => s.enabled)) {
    if (outOfCredits && step.name.startsWith('Hunter')) continue
    if (!(await budgetLeft('finder'))) { notes.push('Daily email-finder budget reached'); break }
    try {
      await spend('finder')
      const found = await step.run()
      if (found) return { found, notes: [...notes, `${step.name}: ${found.email}`], outOfCredits }
      notes.push(`${step.name}: no match`)
    } catch (err) {
      notes.push(err instanceof NoKeyError ? `${step.name}: skipped for now (rate limit or no credits left)` : `${step.name}: ${(err as Error).message}`)
    }
  }
  if (domain && useHunter && !hunterHasData) notes.push('Skipped Hunter lookups to save credits (no data for this domain)')
  return { found: null, notes, outOfCredits }
}
