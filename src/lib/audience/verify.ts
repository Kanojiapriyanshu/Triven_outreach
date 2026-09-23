// Email verification. Free checks (syntax, junk, disposable, MX) always run; a mailbox-level
// check needs a verification provider because outbound port 25 (SMTP probing) is blocked on
// Vercel and most home networks. Set ONE of the provider keys below to get VERIFIED results.
import { domainAcceptsMail } from '../outreach'
import type { EmailStatus } from './taxonomy'

export const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'ymail.com', 'outlook.com',
  'hotmail.com', 'hotmail.co.uk', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com',
  'pm.me', 'gmx.com', 'gmx.net', 'zoho.com', 'zohomail.com', 'yandex.com', 'mail.com', 'rediffmail.com', 'hey.com', 'fastmail.com', 'tutanota.com'])

const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com',
  'trashmail.com', 'getnada.com', 'sharklasers.com', 'throwawaymail.com', 'maildrop.cc', 'dispostable.com', 'fakeinbox.com',
  'mintemail.com', 'mohmal.com', 'emailondeck.com', 'burnermail.io', 'spamgourmet.com', 'tempail.com', 'moakt.com'])

// Addresses that appear in page source but are never a real contact
const JUNK_DOMAINS = /(^|\.)(example\.(com|org|net)|domain\.com|email\.com|yourdomain\.com|yoursite\.com|company\.com|sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|wix\.com|squarespace\.com|godaddy\.com|test\.com|website\.com|mysite\.com|sentry\.wixpress\.com|ingest\.sentry\.io|schema\.org|w3\.org|googleusercontent\.com|cloudflare\.com|youtube\.com|google\.com|apple\.com|facebook\.com|u003e|png|jpg|jpeg|gif|webp|svg)$/i
const JUNK_LOCAL = /^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|abuse|webmaster|hostmaster|privacy|legal|dmca|copyright|user|username|name|yourname|your\.name|firstname|first\.last|email|example|test|john\.doe|jane\.doe|johndoe|someone|you)$/i
export const ROLE_LOCAL = /^(info|hello|hi|contact|admin|office|team|support|help|sales|enquiries|inquiries|mail|business|partnerships?|collab|collabs|press|media|marketing|careers|jobs|hr|billing|accounts|booking|bookings)$/i

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/i

export function normalizeEmail(raw: string) {
  return raw.trim().toLowerCase().replace(/^mailto:/, '').replace(/[?#].*$/, '').replace(/[.,;:)\]]+$/, '')
}

/** Is this a plausible contact address (not a placeholder, asset name or system address)? */
export function isUsableEmail(email: string) {
  if (!EMAIL_RE.test(email) || email.length > 80) return false
  const [local, domain] = email.split('@')
  if (JUNK_DOMAINS.test(domain) || JUNK_LOCAL.test(local)) return false
  if (/^[0-9a-f]{16,}$/.test(local)) return false // hashed tracking ids
  if (/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(email)) return false
  return true
}

export function emailTraits(email: string) {
  const [local, domain] = email.split('@')
  return { isFree: FREE_MAIL.has(domain), isRole: ROLE_LOCAL.test(local), isDisposable: DISPOSABLE.has(domain) }
}

// ─── Providers ───────────────────────────────────────────────────────────────

type Provider = 'ZEROBOUNCE' | 'NEVERBOUNCE' | 'MILLIONVERIFIER' | 'REOON' | 'HUNTER'
const PROVIDER_ENV: Record<Provider, string> = {
  ZEROBOUNCE: 'ZEROBOUNCE_API_KEY',
  NEVERBOUNCE: 'NEVERBOUNCE_API_KEY',
  MILLIONVERIFIER: 'MILLIONVERIFIER_API_KEY',
  REOON: 'REOON_API_KEY',
  // Only when chosen with EMAIL_VERIFIER=HUNTER: on Hunter's free plan every check costs half a
  // credit, and those credits are worth more for finding emails
  HUNTER: 'HUNTER_API_KEY',
}

export function verifierProvider(): Provider | null {
  const named = process.env.EMAIL_VERIFIER?.toUpperCase() as Provider | undefined
  if (named && PROVIDER_ENV[named] && process.env[PROVIDER_ENV[named]]) return named
  return (Object.keys(PROVIDER_ENV) as Provider[]).find((p) => p !== 'HUNTER' && process.env[PROVIDER_ENV[p]]) || null
}

interface Verdict { status: EmailStatus; method: string; detail: string }

async function getJson(url: string) {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(25_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<Record<string, unknown>>
}

async function providerCheck(provider: Provider, email: string): Promise<Verdict> {
  const key = encodeURIComponent(process.env[PROVIDER_ENV[provider]] || '')
  const e = encodeURIComponent(email)
  if (provider === 'ZEROBOUNCE') {
    const d = await getJson(`https://api.zerobounce.net/v2/validate?api_key=${key}&email=${e}&ip_address=`)
    const s = String(d.status || '')
    const status: EmailStatus = s === 'valid' ? 'VERIFIED' : s === 'invalid' || s === 'spamtrap' || s === 'abuse' || s === 'do_not_mail' ? 'INVALID' : s === 'catch-all' ? 'RISKY' : 'UNKNOWN'
    return { status, method: provider, detail: [s, d.sub_status].filter(Boolean).join(' / ') }
  }
  if (provider === 'NEVERBOUNCE') {
    const d = await getJson(`https://api.neverbounce.com/v4/single/check?key=${key}&email=${e}`)
    if (d.status !== 'success') throw new Error(String(d.message || d.status))
    const r = String(d.result || '')
    const status: EmailStatus = r === 'valid' ? 'VERIFIED' : r === 'invalid' || r === 'disposable' ? 'INVALID' : r === 'catchall' ? 'RISKY' : 'UNKNOWN'
    return { status, method: provider, detail: r }
  }
  if (provider === 'MILLIONVERIFIER') {
    const d = await getJson(`https://api.millionverifier.com/api/v3/?api=${key}&email=${e}&timeout=20`)
    if (d.error) throw new Error(String(d.error))
    const r = String(d.result || '')
    const status: EmailStatus = r === 'ok' ? 'VERIFIED' : r === 'invalid' || r === 'disposable' ? 'INVALID' : r === 'catch_all' ? 'RISKY' : 'UNKNOWN'
    return { status, method: provider, detail: [r, d.subresult].filter(Boolean).join(' / ') }
  }
  if (provider === 'HUNTER') {
    const d = await getJson(`https://api.hunter.io/v2/email-verifier?email=${e}&api_key=${key}`) as { data?: { status?: string; result?: string; score?: number } }
    const r = d.data?.result || '', st = d.data?.status || ''
    const status: EmailStatus = st === 'invalid' || st === 'disposable' || r === 'undeliverable' ? 'INVALID'
      : st === 'valid' || (st === 'webmail' && r === 'deliverable') ? 'VERIFIED'
      : st === 'accept_all' || r === 'risky' ? 'RISKY' : 'UNKNOWN'
    return { status, method: provider, detail: [st, r, d.data?.score !== undefined ? `score ${d.data.score}` : ''].filter(Boolean).join(' / ') }
  }
  const d = await getJson(`https://emailverifier.reoon.com/api/v1/verify?email=${e}&key=${key}&mode=power`)
  const r = String(d.status || '')
  const status: EmailStatus = r === 'safe' || r === 'valid' ? 'VERIFIED'
    : r === 'invalid' || r === 'disabled' || r === 'disposable' || r === 'spamtrap' ? 'INVALID'
    : r === 'catch_all' || r === 'role_account' || r === 'inbox_full' ? 'RISKY' : 'UNKNOWN'
  return { status, method: provider, detail: r }
}

/** Hunter's mailbox check on its own (0.5 credit), for the few addresses that decide readiness */
export async function verifyWithHunter(email: string): Promise<Verdict> {
  try {
    return await providerCheck('HUNTER', email)
  } catch (err) {
    return { status: 'UNKNOWN', method: 'HUNTER', detail: `verifier error: ${(err as Error).message}`.slice(0, 180) }
  }
}

/**
 * Full check. Without a provider the best we can honestly say is UNKNOWN (domain receives
 * mail) or INVALID (it can't). Only a provider's mailbox-level "valid" becomes VERIFIED.
 */
export async function verifyEmail(email: string): Promise<Verdict> {
  if (!EMAIL_RE.test(email)) return { status: 'INVALID', method: 'SYNTAX', detail: 'not a valid address' }
  const { isDisposable } = emailTraits(email)
  if (isDisposable) return { status: 'INVALID', method: 'DISPOSABLE', detail: 'disposable inbox' }
  const domain = email.split('@')[1]
  if (!(await domainAcceptsMail(domain))) return { status: 'INVALID', method: 'MX', detail: `${domain} has no mail server` }

  const provider = verifierProvider()
  if (!provider) return { status: 'UNKNOWN', method: 'MX', detail: 'domain accepts mail; mailbox not checked (no verifier key)' }
  try {
    return await providerCheck(provider, email)
  } catch (err) {
    return { status: 'UNKNOWN', method: provider, detail: `verifier error: ${(err as Error).message}`.slice(0, 180) }
  }
}
