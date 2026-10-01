// Email finders beyond Hunter and Apollo. Each returns the same shape, so the waterfall in
// lib/audience/finders.ts can try them one after another. Keys come from the pool
// (lib/providers/keys.ts): several keys per provider, usage counted, exhausted keys parked.
import { normalizeEmail, isUsableEmail } from '../audience/verify'
import type { EmailStatus } from '../audience/taxonomy'
import { withKey, rejection } from './keys'

export interface FinderHit { email: string; confidence: number; status: EmailStatus; detail: string; personName?: string; position?: string; sourceUrl?: string }

const OWNER = /founder|owner|ceo|director|partner|principal|president|dentist|doctor|dds|dmd|manager/i

function status(v?: string | null): EmailStatus {
  const s = (v || '').toLowerCase()
  return s === 'valid' || s === 'verified' ? 'VERIFIED' : s === 'accept_all' || s === 'catch_all' || s === 'risky' ? 'RISKY' : s === 'invalid' ? 'INVALID' : 'UNKNOWN'
}

// ─── Tomba (key is "ta_…:ts_…": API key and secret) ──────────────────────────

interface TombaEmail { email?: string | null; type?: string; first_name?: string | null; last_name?: string | null; full_name?: string | null; position?: string | null; score?: number; verification?: { status?: string | null } | null }

async function tomba<T>(path: string, params: Record<string, string>) {
  return withKey('tomba', async (pair) => {
    const [key, secret] = pair.split(':')
    if (!secret) throw rejection(401, 'Tomba needs key:secret (ta_…:ts_…)')!
    const res = await fetch(`https://api.tomba.io/v1/${path}?${new URLSearchParams(params)}`, {
      headers: { 'X-Tomba-Key': key, 'X-Tomba-Secret': secret, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000), cache: 'no-store',
    })
    const body = await res.json().catch(() => ({})) as { data?: T; errors?: { message?: string; type?: string } }
    if (res.ok) return body.data ?? null
    const rejected = rejection(res.status, body.errors?.message || body.errors?.type || '')
    if (rejected) throw rejected
    if (res.status === 400 || res.status === 404 || res.status === 422 || res.status === 451) return null // unknown or webmail domain: nothing to find
    throw new Error(`Tomba ${path}: ${body.errors?.message || `HTTP ${res.status}`}`)
  })
}

function tombaHit(e: TombaEmail, how: string, domain?: string): FinderHit | null {
  const email = e.email ? normalizeEmail(e.email) : ''
  if (!email || !isUsableEmail(email)) return null
  const name = e.full_name || [e.first_name, e.last_name].filter(Boolean).join(' ')
  return {
    email, confidence: e.score || 0, status: status(e.verification?.status),
    detail: `Tomba ${how}${name ? `: ${name}` : ''}${e.position ? `, ${e.position}` : ''}, score ${e.score ?? '?'}${e.verification?.status ? `, ${e.verification.status}` : ''}`,
    personName: name || undefined, position: e.position || undefined, sourceUrl: domain ? `https://${domain}` : undefined,
  }
}

/** Email of a named person at a domain */
export async function tombaFindEmail(q: { domain?: string; first?: string; last?: string }) {
  if (!q.domain || !q.first || !q.last) return null
  const d = await tomba<TombaEmail>('email-finder', { domain: q.domain, first_name: q.first, last_name: q.last })
  return d ? tombaHit(d, 'match', q.domain) : null
}

/** No name: the decision maker Tomba knows at a small company's domain, else its best address */
export async function tombaDomainOwner(domain: string) {
  const d = await tomba<{ emails?: TombaEmail[] }>('domain-search', { domain, limit: '10' })
  const emails = d?.emails || []
  const pick = emails.find((e) => e.type === 'personal' && OWNER.test(e.position || ''))
    || (emails.length <= 3 ? [...emails].sort((a, b) => (b.score || 0) - (a.score || 0))[0] : undefined)
  return pick ? tombaHit(pick, 'domain search', domain) : null
}

// ─── Prospeo (charged only when an email is returned) ────────────────────────

interface ProspeoBody {
  error?: boolean; error_code?: string; free_enrichment?: boolean
  person?: { full_name?: string | null; current_job_title?: string | null; email?: { status?: string | null; revealed?: boolean; email?: string | null } | null } | null
}

/** Verified work email of a named person at a company */
export async function prospeoFindEmail(q: { first?: string; last?: string; domain?: string; company?: string; linkedIn?: string }): Promise<FinderHit | null> {
  if (!q.linkedIn && !(q.first && q.last && (q.domain || q.company))) return null
  const data: Record<string, string> = {}
  if (q.first) data.first_name = q.first
  if (q.last) data.last_name = q.last
  if (q.domain) data.company_website = q.domain
  if (q.company) data.company_name = q.company
  if (q.linkedIn) data.linkedin_url = q.linkedIn
  const body = await withKey('prospeo', async (key) => {
    const res = await fetch('https://api.prospeo.io/enrich-person', {
      method: 'POST', headers: { 'X-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ only_verified_email: false, data }),
      signal: AbortSignal.timeout(25_000), cache: 'no-store',
    })
    const b = await res.json().catch(() => ({})) as ProspeoBody
    if (res.ok && !b.error) return b
    const code = b.error_code || ''
    if (code === 'NO_MATCH' || code === 'INVALID_DATAPOINTS') return null
    const rejected = rejection(res.status === 400 ? 0 : res.status, code.replace(/_/g, ' ').toLowerCase())
    if (rejected) throw rejected
    throw new Error(`Prospeo: ${code || `HTTP ${res.status}`}`)
  }, { charge: (b) => (b?.person?.email?.email && !b.free_enrichment ? 1 : 0) })
  const e = body?.person?.email
  const email = e?.email && e.revealed !== false ? normalizeEmail(e.email) : ''
  if (!email || !isUsableEmail(email) || email.includes('*')) return null
  return {
    email, confidence: status(e?.status) === 'VERIFIED' ? 95 : 70, status: status(e?.status),
    detail: `Prospeo match${body?.person?.current_job_title ? ` (${body.person.current_job_title})` : ''}, ${(e?.status || 'unverified').toLowerCase()}`,
    personName: body?.person?.full_name || undefined, position: body?.person?.current_job_title || undefined,
  }
}
