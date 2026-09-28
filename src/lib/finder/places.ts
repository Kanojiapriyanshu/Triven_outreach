// Business listings from official, free sources:
//   GOOGLE: Places API (New) Text Search. Free monthly cap per SKU (1,000 Enterprise calls,
//           up to 20 businesses each); the app stops at the cap set in Lead Finder settings so
//           nothing is ever billed. Google Maps pages are never scraped (Maps ToS).
//   OSM:    OpenStreetMap via Nominatim (geocoding) + Overpass (tags). No key, ODbL licence.
import prisma from '../prisma'

export interface PlaceResult {
  placeId: string
  source: 'GOOGLE' | 'OSM'
  name: string
  types: string[]
  category?: string
  address?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  lat?: number
  lng?: number
  phone?: string
  website?: string
  mapsUrl?: string
  rating?: number
  reviewCount?: number
  businessStatus?: string
  hours?: WeekHours
  email?: string
  facebook?: string
  instagram?: string
}

/** Opening hours per day, Monday first: null = closed, [open, close] in minutes after midnight */
export type WeekHours = Array<[number, number] | null>

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function clock(min: number) {
  const h24 = Math.floor(min / 60) % 24, m = min % 60
  const h = h24 % 12 || 12
  return `${h}${m ? `:${String(m).padStart(2, '0')}` : ''}${h24 < 12 ? 'am' : 'pm'}`
}

/**
 * "Mon-Thu 8am-5pm, Fri 8am-1pm, Sat-Sun closed". The wording is what lib/signals.ts reads to
 * personalise emails (closed days, closing time), so keep the shape.
 */
export function formatHours(week?: WeekHours | null) {
  if (!week || week.every((d) => d === null)) return null
  const label = (d: [number, number] | null) => (d ? (d[1] - d[0] >= 1439 ? 'open 24 hours' : `${clock(d[0])}-${clock(d[1])}`) : 'closed')
  const parts: string[] = []
  for (let i = 0; i < 7;) {
    let j = i
    while (j + 1 < 7 && label(week[j + 1]) === label(week[i])) j++
    parts.push(`${DAYS[i]}${j > i ? `-${DAYS[j]}` : ''} ${label(week[i])}`)
    i = j + 1
  }
  return parts.join(', ')
}

export function hoursFacts(week?: WeekHours | null) {
  if (!week || week.every((d) => d === null)) return { openDays: null as number | null, closesAt: null as string | null }
  const openDays = week.filter(Boolean).length
  // Usual weekday closing time: the most common one Mon-Fri
  const counts = new Map<number, number>()
  for (const d of week.slice(0, 5)) if (d) counts.set(d[1], (counts.get(d[1]) || 0) + 1)
  const close = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0]
  return { openDays, closesAt: close !== undefined && close < 1439 ? clock(close) : null }
}

// ─── Google Places API (New) ─────────────────────────────────────────────────

export function googleConfigured() {
  return !!process.env.GOOGLE_PLACES_API_KEY
}

const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents', 'places.location', 'places.types',
  'places.primaryTypeDisplayName', 'places.nationalPhoneNumber', 'places.internationalPhoneNumber', 'places.websiteUri',
  'places.googleMapsUri', 'places.rating', 'places.userRatingCount', 'places.businessStatus', 'places.regularOpeningHours', 'nextPageToken',
].join(',')

interface GPlace {
  id: string
  displayName?: { text?: string }
  formattedAddress?: string
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>
  location?: { latitude?: number; longitude?: number }
  types?: string[]
  primaryTypeDisplayName?: { text?: string }
  nationalPhoneNumber?: string
  internationalPhoneNumber?: string
  websiteUri?: string
  googleMapsUri?: string
  rating?: number
  userRatingCount?: number
  businessStatus?: string
  regularOpeningHours?: { periods?: Array<{ open?: { day?: number; hour?: number; minute?: number }; close?: { day?: number; hour?: number; minute?: number } }> }
}

function googleWeek(p: GPlace): WeekHours | undefined {
  const periods = p.regularOpeningHours?.periods
  if (!periods?.length) return undefined
  // Open 24/7 is a single period with no close
  if (periods.length === 1 && !periods[0].close) return Array(7).fill([0, 1439])
  const week: WeekHours = Array(7).fill(null)
  for (const per of periods) {
    if (per.open?.day === undefined) continue
    const idx = (per.open.day + 6) % 7 // Google: 0 = Sunday
    const open = (per.open.hour || 0) * 60 + (per.open.minute || 0)
    let close = per.close ? (per.close.hour || 0) * 60 + (per.close.minute || 0) : 1439
    if (per.close && per.close.day !== per.open.day) close = close === 0 ? 1439 : Math.min(1439, close + 1440) // past midnight
    const cur = week[idx]
    // Lunch breaks: first open to last close
    week[idx] = cur ? [Math.min(cur[0], open), Math.max(cur[1], close)] : [open, close]
  }
  return week
}

function component(p: GPlace, type: string, short = false) {
  const c = p.addressComponents?.find((x) => x.types?.includes(type))
  return (short ? c?.shortText : c?.longText) || undefined
}

export class PlacesError extends Error {
  constructor(message: string, public code?: 'QUOTA' | 'KEY' | 'CAP') { super(message) }
}

/** One page (up to 20 places). Counted against the monthly free cap before the call is made. */
export async function googleTextSearch(textQuery: string, opts: { pageToken?: string | null; regionCode?: string | null }) {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) throw new PlacesError('Add GOOGLE_PLACES_API_KEY to use Google business search', 'KEY')
  await reserveGoogleCall()
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify({
      textQuery, pageSize: 20, languageCode: 'en',
      ...(opts.pageToken ? { pageToken: opts.pageToken } : {}),
      ...(opts.regionCode ? { regionCode: opts.regionCode } : {}),
    }),
    signal: AbortSignal.timeout(20_000), cache: 'no-store',
  })
  const body = await res.json().catch(() => ({})) as { places?: GPlace[]; nextPageToken?: string; error?: { message?: string; status?: string } }
  if (!res.ok) {
    const msg = body.error?.message || `HTTP ${res.status}`
    if (res.status === 429 || body.error?.status === 'RESOURCE_EXHAUSTED') throw new PlacesError(`Google quota reached: ${msg}`, 'QUOTA')
    if (res.status === 403 || res.status === 400 && /api key/i.test(msg)) throw new PlacesError(`Google Places key problem: ${msg}`, 'KEY')
    throw new PlacesError(`Google Places: ${msg}`)
  }
  const places: PlaceResult[] = (body.places || []).map((p) => ({
    placeId: p.id,
    source: 'GOOGLE',
    name: p.displayName?.text || 'Unnamed',
    types: p.types || [],
    category: p.primaryTypeDisplayName?.text,
    address: p.formattedAddress,
    city: component(p, 'locality') || component(p, 'postal_town') || component(p, 'sublocality'),
    state: component(p, 'administrative_area_level_1', true),
    postalCode: component(p, 'postal_code'),
    country: component(p, 'country', true),
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    phone: p.nationalPhoneNumber || p.internationalPhoneNumber,
    website: p.websiteUri,
    mapsUrl: p.googleMapsUri,
    rating: p.rating,
    reviewCount: p.userRatingCount || 0,
    businessStatus: p.businessStatus,
    hours: googleWeek(p),
  }))
  return { places, nextPageToken: body.nextPageToken || null }
}

// Monthly usage, so the free cap is never crossed
const USAGE_KEY = 'finder_google_usage'

function monthKey() {
  return new Date().toISOString().slice(0, 7)
}

export async function googleUsage() {
  const row = await prisma.setting.findUnique({ where: { key: USAGE_KEY } })
  const saved = row ? JSON.parse(row.value) as { month: string; calls: number } : null
  return saved?.month === monthKey() ? saved.calls : 0
}

async function reserveGoogleCall() {
  const { getFinderSettings } = await import('./settings')
  const cap = (await getFinderSettings()).googleMonthlyCap
  const used = await googleUsage()
  if (used >= cap) throw new PlacesError(`Monthly Google cap reached (${used}/${cap} calls). It resets on the 1st, or raise it in Lead Finder settings.`, 'CAP')
  const value = JSON.stringify({ month: monthKey(), calls: used + 1 })
  await prisma.setting.upsert({ where: { key: USAGE_KEY }, create: { key: USAGE_KEY, value }, update: { value } })
}

// ─── OpenStreetMap ───────────────────────────────────────────────────────────

const OSM_UA = 'TrivenCRM/1.0 (lead finder; contact via site operator)'
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

/** Bounding box of a place name (Nominatim, max 1 request/second by their policy) */
export async function geocode(location: string, country?: string | null) {
  const qs = new URLSearchParams({ q: location, format: 'json', limit: '1', ...(country ? { countrycodes: country.toLowerCase() } : {}) })
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`, { headers: { 'User-Agent': OSM_UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(15_000), cache: 'no-store' })
  if (!res.ok) throw new Error(`Geocoding failed (HTTP ${res.status})`)
  const d = await res.json() as Array<{ boundingbox: [string, string, string, string]; display_name: string }>
  if (!d[0]) throw new Error(`Couldn't find "${location}" on the map`)
  const [s, n, w, e] = d[0].boundingbox.map(Number)
  return { south: s, north: n, west: w, east: e, label: d[0].display_name }
}

const OSM_DAY: Record<string, number> = { mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6 }

/** The common subset of OSM opening_hours: "Mo-Th 08:00-17:00; Fr 08:00-13:00; Sa,Su off" */
export function parseOsmHours(raw?: string): WeekHours | undefined {
  if (!raw) return undefined
  if (/^\s*24\/7\s*$/.test(raw)) return Array(7).fill([0, 1439])
  const week: WeekHours = Array(7).fill(null)
  let any = false
  for (const rule of raw.split(';')) {
    const m = rule.trim().match(/^((?:(?:mo|tu|we|th|fr|sa|su)(?:\s*-\s*(?:mo|tu|we|th|fr|sa|su))?\s*,?\s*)+)\s+(.+)$/i)
    if (!m) continue
    const days: number[] = []
    for (const part of m[1].split(',')) {
      const [a, b] = part.trim().toLowerCase().split(/\s*-\s*/)
      if (!(a in OSM_DAY)) continue
      const from = OSM_DAY[a], to = b && b in OSM_DAY ? OSM_DAY[b] : from
      for (let d = from; d !== (to + 1) % 7; d = (d + 1) % 7) { days.push(d); if (days.length > 7) break }
    }
    const spec = m[2].trim().toLowerCase()
    if (spec === 'off' || spec === 'closed') { for (const d of days) week[d] = null; any = true; continue }
    const times = [...spec.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)]
    if (!times.length) continue
    const open = Math.min(...times.map((t) => Number(t[1]) * 60 + Number(t[2])))
    const close = Math.max(...times.map((t) => Math.min(1439, Number(t[3]) * 60 + Number(t[4]))))
    for (const d of days) week[d] = [open, close]
    any = true
  }
  return any ? week : undefined
}

function osmFilter(f: string) {
  return f.split('][').map((kv) => {
    const [k, v] = kv.split('=')
    return v ? `["${k}"="${v}"]` : `["${k}"]`
  }).join('')
}

/** Every business with the niche's tags inside the location's bounding box */
export async function osmSearch(filters: string[], location: string, country?: string | null, limit = 200): Promise<PlaceResult[]> {
  if (!filters.length) throw new Error('OpenStreetMap needs a niche from the list (free-text search is Google only)')
  const box = await geocode(location, country)
  const bbox = `${box.south},${box.west},${box.north},${box.east}`
  const query = `[out:json][timeout:12];(${filters.map((f) => `nwr${osmFilter(f)}["name"](${bbox});`).join('')});out center tags ${limit};`
  // The main public server is often overloaded; the community mirrors serve the same data
  let d: { elements: Array<{ type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> } | null = null
  let lastError = ''
  for (const endpoint of OVERPASS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'User-Agent': OSM_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(14_000), cache: 'no-store',
      })
      if (res.ok) { d = await res.json(); break }
      lastError = `HTTP ${res.status}`
    } catch (err) {
      lastError = (err as Error).message
    }
  }
  if (!d) throw new Error(`OpenStreetMap servers are busy (${lastError}); the search retries on the next run`)
  return d.elements.filter((e) => e.tags?.name).map((e) => {
    const t = e.tags!
    const website = t.website || t['contact:website'] || t.url
    return {
      placeId: `osm:${e.type}/${e.id}`,
      source: 'OSM' as const,
      name: t.name,
      types: Object.entries(t).filter(([k]) => /^(amenity|shop|craft|office|healthcare|leisure)$/.test(k)).map(([, v]) => v),
      category: (t.healthcare || t.amenity || t.craft || t.office || t.shop || '').replace(/_/g, ' ') || undefined,
      address: [[t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '), t['addr:city'], t['addr:state'], t['addr:postcode']].filter(Boolean).join(', ') || undefined,
      city: t['addr:city'],
      state: t['addr:state'],
      postalCode: t['addr:postcode'],
      country: (t['addr:country'] || country || '').toUpperCase() || undefined,
      lat: e.lat ?? e.center?.lat,
      lng: e.lon ?? e.center?.lon,
      phone: t.phone || t['contact:phone'],
      website: website && !/^https?:\/\//i.test(website) ? `https://${website}` : website,
      mapsUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`,
      email: t.email || t['contact:email'],
      facebook: t['contact:facebook'] || t.facebook,
      instagram: t['contact:instagram'] || t.instagram,
      hours: parseOsmHours(t.opening_hours),
      businessStatus: t['disused:amenity'] || t.disused ? 'CLOSED_PERMANENTLY' : 'OPERATIONAL',
    }
  })
}
