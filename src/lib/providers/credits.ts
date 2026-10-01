// What System Health shows for each data service in use: what it is for, why it is in the chain,
// how many credits are left and when they renew. Numbers come from the service's own account
// endpoint where it has one (Hunter, Tomba, Reoon, Serper); the others are counted by our key pool.
import { keysOf, keyLabel, providerStatus, type ProviderId, type ProviderKind } from './keys'

export interface ServiceCredits {
  id: string
  label: string
  kind: ProviderKind
  /** What it does for us, and why it is worth having */
  use: string
  why: string
  /** PAUSED = credits are left but every key is resting (rate limit); it resumes on its own */
  state: 'OK' | 'PAUSED' | 'EXHAUSTED' | 'ERROR' | 'FREE'
  /** Credits left / the full allowance for the period (null = not limited or unknown) */
  left: number | null
  total: number | null
  /** What a credit is and how often the allowance comes back */
  unit: string
  /** When the allowance renews (ISO), or null when it never does / never runs out */
  renews: string | null
  renewNote: string
  /** True when the numbers come from the service itself rather than our own count */
  live: boolean
  keys: Array<{ label: string; left: number | null; paused: string | null; reason: string | null }>
}

const WHY: Record<string, { use: string; why: string }> = {
  google: { use: 'Finds businesses in a city', why: 'The only source with ratings, review counts and opening hours, which sharpen the fit score and the email\'s first line.' },
  foursquare: { use: 'Finds businesses in a city', why: 'Its listings carry the website and often an email, so many leads need no further lookup.' },
  tomtom: { use: 'Finds businesses in a city', why: 'A second, independent list with phone and website: it catches businesses the other sources miss.' },
  serper: { use: 'Web search', why: 'Finds the website of listings that have none, emails published on other sites, and the owner\'s name.' },
  brave: { use: 'Web search', why: 'Same job as Serper; takes over when Serper is out of credits.' },
  hunter: { use: 'Finds emails', why: 'Asked only when a business\'s own website shows no email. A free check runs first so no credit is wasted.' },
  tomba: { use: 'Finds emails', why: 'Second email finder: asked when Hunter finds nothing or is out of credits. Charged only when it finds an address.' },
  prospeo: { use: 'Finds emails', why: 'Verified email of a named owner. Charged only when it finds one.' },
  apollo: { use: 'Finds emails', why: 'Email of a named owner, from Apollo\'s contact database.' },
  reoon: { use: 'Checks emails', why: 'Confirms the mailbox exists before anything is sent, which keeps bounces low and protects your inboxes.' },
  zerobounce: { use: 'Checks emails', why: 'Takes over mailbox checks when the verifier before it runs out.' },
  millionverifier: { use: 'Checks emails', why: 'Takes over mailbox checks when the verifier before it runs out.' },
  neverbounce: { use: 'Checks emails', why: 'Takes over mailbox checks when the verifier before it runs out.' },
}

interface Live { left: number; total: number | null; renews: string | null }

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000), cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<Record<string, unknown>>
}

// One function per service that can tell us its own balance
const LIVE: Partial<Record<ProviderId, (key: string) => Promise<Live>>> = {
  hunter: async (key) => {
    const d = (await json(`https://api.hunter.io/v2/account?api_key=${encodeURIComponent(key)}`)).data as { reset_date?: string; requests?: { credits?: { available?: number; remaining?: number } } }
    return { left: Math.floor(d?.requests?.credits?.remaining ?? 0), total: Math.floor(d?.requests?.credits?.available ?? 0), renews: d?.reset_date ? new Date(d.reset_date).toISOString() : null }
  },
  tomba: async (pair) => {
    const [k, s] = pair.split(':')
    const headers = { 'X-Tomba-Key': k, 'X-Tomba-Secret': s || '' }
    const me = (await json('https://api.tomba.io/v1/me', { headers })).data as { expired?: string; pricing?: { available_searches?: number } }
    await new Promise((r) => setTimeout(r, 1_200)) // one request a second on the free plan
    const used = ((await json('https://api.tomba.io/v1/usage', { headers }).catch(() => ({}))) as { total?: { search?: number } }).total?.search ?? 0
    const total = me?.pricing?.available_searches ?? 0
    return { left: Math.max(0, total - used), total, renews: me?.expired ? new Date(me.expired).toISOString() : null }
  },
  reoon: async (key) => {
    const d = await json(`https://emailverifier.reoon.com/api/v1/check-account-balance/?key=${encodeURIComponent(key)}`) as { remaining_daily_credits?: number; remaining_instant_credits?: number }
    return { left: (d.remaining_daily_credits ?? 0) + (d.remaining_instant_credits ?? 0), total: null, renews: tomorrow() }
  },
  serper: async (key) => {
    const d = await json('https://google.serper.dev/account', { headers: { 'X-API-KEY': key } }) as { balance?: number }
    return { left: d.balance ?? 0, total: null, renews: null }
  },
}

const UNIT: Partial<Record<ProviderId, { unit: string; renewNote: string }>> = {
  hunter: { unit: 'credits', renewNote: 'Renews monthly' },
  tomba: { unit: 'searches', renewNote: 'Renews monthly · at most 5 a day' },
  reoon: { unit: 'checks', renewNote: '20 renew every day, plus one-time bonus credits' },
  serper: { unit: 'searches', renewNote: 'One-time credits: they do not renew' },
  foursquare: { unit: 'searches', renewNote: 'Renews on the 1st of each month' },
  tomtom: { unit: 'searches', renewNote: 'Renews every day' },
  google: { unit: 'searches', renewNote: 'Renews on the 1st of each month' },
}

function tomorrow() {
  const n = new Date()
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1)).toISOString()
}
function nextMonth() {
  const n = new Date()
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1)).toISOString()
}

// Balances are asked for at most every 5 minutes (the page refreshes every 30 seconds)
let cache: { at: number; data: ServiceCredits[] } | null = null

/** Every service that is set up (plus the two that need no key), with its credits and renewal */
export async function serviceCredits(): Promise<ServiceCredits[]> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.data
  const status = (await providerStatus()).filter((p) => p.state !== 'OFF')
  const rows = await Promise.all(status.map(async (p): Promise<ServiceCredits> => {
    const keys = keysOf(p.id)
    const meta = UNIT[p.id] || { unit: 'calls', renewNote: 'Pay as you go' }
    const ask = LIVE[p.id]
    const lives = ask ? await Promise.all(keys.map((k) => ask(k).catch(() => null))) : []
    const gotLive = lives.some(Boolean)
    const perKey = p.keys.map((k, i) => ({
      label: k.label || keyLabel(keys[i]), paused: k.blockedUntil, reason: k.reason,
      left: lives[i] ? lives[i]!.left : k.left,
    }))
    const sum = (xs: Array<number | null>) => (xs.some((x) => x === null) ? null : xs.reduce<number>((a, b) => a + (b as number), 0))
    const left = sum(perKey.map((k) => k.left))
    const total = gotLive ? sum(lives.map((l) => (l ? l.total : null))) : p.daily ? p.daily * keys.length : p.capMonth
    const renews = gotLive ? lives.map((l) => l?.renews).filter(Boolean).sort()[0] || null : p.daily ? tomorrow() : p.capMonth ? nextMonth() : null
    return {
      id: p.id, label: p.label, kind: p.kind, ...(WHY[p.id] || { use: p.use, why: '' }),
      state: left === 0 ? 'EXHAUSTED' : p.state === 'EXHAUSTED' && gotLive ? 'PAUSED' : p.state === 'OFF' ? 'OK' : p.state,
      left, total, unit: meta.unit, renews, renewNote: meta.renewNote, live: gotLive, keys: perKey,
    }
  }))
  const free = (id: string, label: string, use: string, why: string): ServiceCredits => ({
    id, label, kind: 'discovery', use, why, state: 'FREE', left: null, total: null, unit: 'searches', renews: null, renewNote: 'Free and unlimited: no key, nothing to renew', live: false, keys: [],
  })
  const data = [
    ...rows,
    free('npi', 'NPI Registry', 'Finds US health practices', 'The official US government list of every dental, chiropractic, optometry, physical-therapy and dermatology practice, with phone and a named contact.'),
    free('osm', 'OpenStreetMap', 'Finds businesses in a city', 'Free map data for every niche; some listings already include an email.'),
  ]
  cache = { at: Date.now(), data }
  return data
}
