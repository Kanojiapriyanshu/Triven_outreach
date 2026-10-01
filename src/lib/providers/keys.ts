// One place that knows every outside data service: which keys are configured, how much of each
// key's free allowance is used, and which key to use next.
//
//   • Every provider's env var may hold several keys, separated by commas, spaces or new lines.
//   • withKey() picks the least-used key that still has room, runs the call, and counts it.
//   • A call that fails with "out of credits", "rate limited" or "bad key" parks that key (until
//     the allowance resets, for a few minutes, or for a day) and the next key is tried at once.
//   • When no key is left the caller gets NoKeyError and moves on to the next provider.
//
// Usage lives in one row of the `settings` table, so it needs no migration and survives deploys.
import prisma from '../prisma'

export type ProviderId =
  | 'google' | 'foursquare' | 'tomtom'
  | 'serper' | 'brave'
  | 'hunter' | 'tomba' | 'prospeo' | 'apollo'
  | 'reoon' | 'zerobounce' | 'millionverifier' | 'neverbounce'

export type ProviderKind = 'discovery' | 'search' | 'finder' | 'verifier'

export interface ProviderSpec {
  id: ProviderId
  label: string
  kind: ProviderKind
  env: string
  /** What it adds, in one line */
  use: string
  /** The free allowance, in words */
  free: string
  /** Calls allowed per key per month / per day before we stop on our own (free-plan defaults) */
  monthly?: number
  daily?: number
  /** When an empty key comes back, for services we don't cap ourselves (default: next month) */
  resets?: 'daily'
  signup: string
  /** Shape of the key when it isn't a single token */
  keyHint?: string
}

export const PROVIDERS: ProviderSpec[] = [
  { id: 'google', label: 'Google Places', kind: 'discovery', env: 'GOOGLE_PLACES_API_KEY', use: 'Businesses with ratings, reviews and opening hours', free: '~1,000 searches a month (cap set in Lead Finder → Rules)', signup: 'https://console.cloud.google.com/apis/library/places.googleapis.com' },
  { id: 'foursquare', label: 'Foursquare Places', kind: 'discovery', env: 'FOURSQUARE_API_KEY', use: 'Businesses with website, phone and often an email', free: '10,000 searches a month', monthly: 9000, signup: 'https://foursquare.com/developers/signup' },
  { id: 'tomtom', label: 'TomTom Search', kind: 'discovery', env: 'TOMTOM_API_KEY', use: 'Businesses with website and phone', free: '2,500 searches a day', daily: 2000, signup: 'https://developer.tomtom.com/user/register' },
  { id: 'serper', label: 'Serper (Google search)', kind: 'search', env: 'SERPER_API_KEY', use: 'Finds a business\'s website, emails published elsewhere, the owner\'s name', free: '2,500 searches once', signup: 'https://serper.dev' },
  { id: 'brave', label: 'Brave Search', kind: 'search', env: 'BRAVE_SEARCH_API_KEY', use: 'Same as Serper, and allows "@domain" searches', free: 'Free monthly searches', signup: 'https://brave.com/search/api/' },
  { id: 'hunter', label: 'Hunter', kind: 'finder', env: 'HUNTER_API_KEY', use: 'Email of a named person, or the owner at a domain', free: '~25 searches a month', signup: 'https://hunter.io/users/sign_up' },
  { id: 'tomba', label: 'Tomba', kind: 'finder', env: 'TOMBA_API_KEY', use: 'Email of a named person, or addresses at a domain', free: '~25 searches a month (5 a day)', monthly: 25, daily: 5, signup: 'https://app.tomba.io/auth/register', keyHint: 'key:secret (ta_…:ts_…)' },
  { id: 'prospeo', label: 'Prospeo', kind: 'finder', env: 'PROSPEO_API_KEY', use: 'Verified email of a named person at a company', free: '~75 credits a month (charged only when found)', monthly: 75, signup: 'https://prospeo.io' },
  { id: 'apollo', label: 'Apollo', kind: 'finder', env: 'APOLLO_API_KEY', use: 'Email of a named person', free: 'Limited on the free plan', signup: 'https://www.apollo.io' },
  { id: 'reoon', label: 'Reoon', kind: 'verifier', env: 'REOON_API_KEY', use: 'Confirms a mailbox exists', free: '~600 checks a month (20 a day)', resets: 'daily', signup: 'https://www.reoon.com/email-verifier/' },
  { id: 'zerobounce', label: 'ZeroBounce', kind: 'verifier', env: 'ZEROBOUNCE_API_KEY', use: 'Confirms a mailbox exists', free: '100 checks a month', monthly: 100, signup: 'https://www.zerobounce.net' },
  { id: 'millionverifier', label: 'MillionVerifier', kind: 'verifier', env: 'MILLIONVERIFIER_API_KEY', use: 'Confirms a mailbox exists', free: 'Trial credits, then pay as you go', signup: 'https://www.millionverifier.com' },
  { id: 'neverbounce', label: 'NeverBounce', kind: 'verifier', env: 'NEVERBOUNCE_API_KEY', use: 'Confirms a mailbox exists', free: 'Trial credits, then pay as you go', signup: 'https://neverbounce.com' },
]

const SPEC = new Map(PROVIDERS.map((p) => [p.id, p]))

/** Every key set for a provider (comma, space or newline separated; duplicates dropped) */
export function keysOf(id: ProviderId): string[] {
  const raw = process.env[SPEC.get(id)!.env] || ''
  return [...new Set(raw.split(/[\s,;]+/).map((k) => k.trim()).filter(Boolean))]
}

export function configured(id: ProviderId) {
  return keysOf(id).length > 0
}

/** Paid plans raise the built-in free-plan caps with <ENV>_MONTHLY_CAP / <ENV>_DAILY_CAP (0 = no cap) */
function cap(id: ProviderId, period: 'monthly' | 'daily') {
  const spec = SPEC.get(id)!
  const override = process.env[`${spec.env.replace(/_API_KEY$/, '')}_${period.toUpperCase()}_CAP`]
  if (override !== undefined && override !== '' && !Number.isNaN(Number(override))) return Number(override) || undefined
  return spec[period]
}

/** The key failed in a way that says "don't use me for a while" */
export class KeyRejected extends Error {
  constructor(message: string, public kind: 'quota' | 'rate' | 'auth', public until?: Date) { super(message) }
}

/** No key is configured, or every key is used up / parked */
export class NoKeyError extends Error {
  constructor(public provider: ProviderId, public reason: 'none' | 'exhausted', message: string) { super(message) }
}

/** Turn a provider's error text / HTTP status into a KeyRejected, or null when it isn't the key's fault */
export function rejection(status: number, message = ''): KeyRejected | null {
  const m = message.slice(0, 200)
  if (status === 401 || /invalid.{0,12}(api )?key|api.?key.{0,20}(invalid|not found|missing)|unauthori[sz]ed|auth(entication)?.fail/i.test(m)) return new KeyRejected(m || `HTTP ${status}`, 'auth')
  // "Too fast" is checked before "out of credits": "Rate limit exceeded (rpm)" is a short rest, not an empty account
  if (/too many requests|rate.?limit|throttl|\b(rps|rpm)\b|per (second|minute)/i.test(m)) return new KeyRejected(m || `HTTP ${status}`, 'rate')
  if (status === 402 || /insufficient|out of credits?|no credits?|ran out|credits? (left|remaining|balance).{0,6}\b0\b|quota|usage limit|limit (reached|exceeded)|exceeded.{0,20}limit|over the limit/i.test(m)) return new KeyRejected(m || `HTTP ${status}`, 'quota')
  if (status === 429) return new KeyRejected(m || `HTTP ${status}`, 'rate')
  if (status === 403) return new KeyRejected(m || 'HTTP 403', 'auth')
  return null
}

// ─── Usage ───────────────────────────────────────────────────────────────────

interface KeyUse { month: string; used: number; day: string; today: number; blockedUntil?: string; reason?: string; lastOk?: string }
type Usage = Record<string, KeyUse>

const USAGE_KEY = 'provider_usage'
const month = () => new Date().toISOString().slice(0, 7)
const day = () => new Date().toISOString().slice(0, 10)
/** Keys are never stored or shown in full: the last 4 characters identify them */
export const keyLabel = (key: string) => `…${key.replace(/^.*:/, '').slice(-4)}`
const slot = (id: ProviderId, key: string) => `${id}:${key.replace(/^.*:/, '').slice(-6)}`

async function load(): Promise<Usage> {
  const row = await prisma.setting.findUnique({ where: { key: USAGE_KEY } })
  try { return row ? JSON.parse(row.value) as Usage : {} } catch { return {} }
}

function current(u: Usage, s: string): KeyUse {
  const k = u[s] || { month: month(), used: 0, day: day(), today: 0 }
  return { ...k, used: k.month === month() ? k.used : 0, month: month(), today: k.day === day() ? k.today : 0, day: day() }
}

// Updates from parallel calls in this process queue up, so one never overwrites another
let chain: Promise<unknown> = Promise.resolve()
function update(s: string, change: (k: KeyUse) => KeyUse) {
  const run = chain.then(async () => {
    const u = await load()
    u[s] = change(current(u, s))
    const value = JSON.stringify(u)
    await prisma.setting.upsert({ where: { key: USAGE_KEY }, create: { key: USAGE_KEY, value }, update: { value } })
  }).catch(() => null)
  chain = run
  return run
}

function nextReset(id: ProviderId, kind: KeyRejected['kind']) {
  const now = new Date()
  if (kind === 'rate') return new Date(now.getTime() + 3 * 60_000)
  if (kind === 'auth') return new Date(now.getTime() + 24 * 3_600_000)
  if (cap(id, 'daily') || SPEC.get(id)!.resets === 'daily') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

function roomLeft(id: ProviderId, k: KeyUse) {
  const m = cap(id, 'monthly'), d = cap(id, 'daily')
  return Math.min(m ? m - k.used : Infinity, d ? d - k.today : Infinity)
}

/** Park a key by hand (e.g. the provider's own account endpoint says it has no credits left) */
export function parkKey(id: ProviderId, key: string, reason: string, until?: Date) {
  return update(slot(id, key), (k) => ({ ...k, blockedUntil: (until || nextReset(id, 'quota')).toISOString(), reason: reason.slice(0, 160) }))
}

/**
 * Run a call with the best available key. `cost` is what one call uses (default 1); pass
 * `charge` to bill by the result instead (e.g. 0 when nothing was found).
 */
export async function withKey<T>(id: ProviderId, fn: (key: string) => Promise<T>, opts: { cost?: number; charge?: (result: T) => number } = {}): Promise<T> {
  const spec = SPEC.get(id)!
  const keys = keysOf(id)
  if (!keys.length) throw new NoKeyError(id, 'none', `${spec.label}: no key set (${spec.env})`)
  const usage = await load()
  const now = Date.now()
  const ready = keys
    .map((key) => ({ key, s: slot(id, key), use: current(usage, slot(id, key)) }))
    .filter((k) => !(k.use.blockedUntil && new Date(k.use.blockedUntil).getTime() > now) && roomLeft(id, k.use) > 0)
    .sort((a, b) => a.use.used - b.use.used)

  let last = ''
  for (const k of ready) {
    try {
      const result = await fn(k.key)
      const n = opts.charge ? opts.charge(result) : opts.cost ?? 1
      // Free calls on a healthy key change nothing worth a write
      if (n > 0 || k.use.blockedUntil) await update(k.s, (u) => ({ ...u, used: u.used + n, today: u.today + n, blockedUntil: undefined, reason: undefined, lastOk: new Date().toISOString() }))
      return result
    } catch (err) {
      if (!(err instanceof KeyRejected)) throw err
      last = err.message
      const until = err.until || nextReset(id, err.kind)
      await update(k.s, (u) => ({ ...u, blockedUntil: until.toISOString(), reason: `${err.kind === 'auth' ? 'Key rejected' : err.kind === 'rate' ? 'Rate limited' : 'Out of credits'}: ${err.message}`.slice(0, 160) }))
    }
  }
  throw new NoKeyError(id, 'exhausted', `${spec.label}: ${keys.length > 1 ? `all ${keys.length} keys are` : 'the key is'} used up or paused${last ? ` (${last})` : ''}`)
}

/** Can this provider take a call right now? (a key exists with room and isn't parked) */
export async function available(id: ProviderId) {
  const keys = keysOf(id)
  if (!keys.length) return false
  const usage = await load()
  return keys.some((key) => {
    const k = current(usage, slot(id, key))
    return !(k.blockedUntil && new Date(k.blockedUntil).getTime() > Date.now()) && roomLeft(id, k) > 0
  })
}

export interface ProviderStatus extends ProviderSpec {
  state: 'OK' | 'EXHAUSTED' | 'ERROR' | 'OFF'
  usedMonth: number
  capMonth: number | null
  keys: Array<{ label: string; usedMonth: number; usedToday: number; left: number | null; blockedUntil: string | null; reason: string | null }>
}

/** Everything System Health needs to show: per provider and per key (keys shown as their last 4 characters) */
export async function providerStatus(): Promise<ProviderStatus[]> {
  const usage = await load()
  const now = Date.now()
  return PROVIDERS.map((spec) => {
    const keys = keysOf(spec.id).map((key) => {
      const k = current(usage, slot(spec.id, key))
      const blocked = k.blockedUntil && new Date(k.blockedUntil).getTime() > now
      const left = roomLeft(spec.id, k)
      return { label: keyLabel(key), usedMonth: k.used, usedToday: k.today, left: Number.isFinite(left) ? Math.max(0, left) : null, blockedUntil: blocked ? k.blockedUntil! : null, reason: blocked ? k.reason || null : null }
    })
    const usable = keys.filter((k) => !k.blockedUntil && (k.left === null || k.left > 0))
    const m = cap(spec.id, 'monthly')
    return {
      ...spec,
      state: !keys.length ? 'OFF' : usable.length ? 'OK' : keys.some((k) => /rejected/i.test(k.reason || '')) ? 'ERROR' : 'EXHAUSTED',
      usedMonth: keys.reduce((n, k) => n + k.usedMonth, 0),
      capMonth: m ? m * keys.length : null,
      keys,
    }
  })
}
