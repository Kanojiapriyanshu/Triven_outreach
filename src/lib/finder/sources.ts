// Where businesses come from. Every source returns the same PlaceResult, so the pipeline can
// run one of them or (provider "AUTO") all that apply, one after another, and merge what they find.
//
//   GOOGLE      Places API (New): ratings, reviews, hours. Monthly cap in Lead Finder → Rules.
//   FOURSQUARE  Places API: website, phone, often an email. 10,000 free calls a month.
//   TOMTOM      POI search: website and phone. 2,500 free calls a day.
//   NPI         US government registry of health providers (dentists, chiropractors…): every
//               practice with address, phone and its official contact. Free, no key. No websites,
//               so research finds the site by web search.
//   OSM         OpenStreetMap: free, no key, often carries an email.
import { googleConfigured, googleTextSearch, googleUsage, osmSearch, geocode, type PlaceResult } from './places'
import { getFinderSettings } from './settings'
import type { Niche } from './niches'
import { SOURCE_LABEL } from './source-labels'
import { available, configured, withKey, rejection } from '../providers/keys'

export type SourceId = 'GOOGLE' | 'FOURSQUARE' | 'TOMTOM' | 'NPI' | 'OSM'
export type SearchProvider = SourceId | 'AUTO'

export { SOURCE_LABEL }

export interface SourceQuery {
  query: string
  niche: Niche | null
  location: string
  country?: string | null
  /** Paging token returned by the previous page (null = first page) */
  token?: string | null
  /** How many businesses this search wants from this location */
  max: number
}

export interface SourcePage { places: PlaceResult[]; next: string | null }

// ─── NPI Registry (US health providers) ──────────────────────────────────────

// Niche → NPI taxonomy description (matched as a prefix by the registry)
const NPI_TAXONOMY: Record<string, string> = {
  dental: 'Dentist', orthodontist: 'Orthodontics', chiropractor: 'Chiropractor', physio: 'Physical Therapist',
  dermatology: 'Dermatology', optometrist: 'Optometrist',
}

const US_STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
}
const US_CODES = new Set(Object.values(US_STATE_NAMES))

/** "Tampa, FL" · "Tampa FL" · "Miami, Florida" · "Florida" · "33607" → what the registry can filter on */
export function parseUsLocation(location: string) {
  const clean = location.replace(/[,\s]+(usa|us|united states)\.?$/i, '').trim()
  if (/^\d{5}$/.test(clean)) return { postal: clean }
  const stateOf = (t: string) => US_STATE_NAMES[t.toLowerCase()] || (t.length === 2 && US_CODES.has(t.toUpperCase()) ? t.toUpperCase() : '')
  if (stateOf(clean)) return { state: stateOf(clean) }
  // The state is the last word or the last two ("Fort Lauderdale FL", "Charlotte, North Carolina")
  const words = clean.split(/[,\s]+/).filter(Boolean)
  for (const n of [2, 1]) {
    const state = words.length > n ? stateOf(words.slice(-n).join(' ')) : ''
    if (state) return { city: clean.replace(new RegExp(`[,\\s]+${words.slice(-n).join('\\s+')}$`, 'i'), '').trim(), state }
  }
  return { city: clean }
}

const title = (s?: string | null) => (s || '').toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Llc|Pllc|Pa|Pc|Dds|Dmd|Md|Pt|Dc|Od|Ii|Iii)\b/g, (w) => w.toUpperCase()).trim()

// The registry's "authorized official" is often a billing or legal contact: keep only real decision makers
const DECISION_MAKER = /owner|president|ceo|founder|partner|principal|member|manag(er|ing)|director|dentist|doctor|physician|chiropractor|optometrist|therapist|d\.?d\.?s|d\.?m\.?d/i
const NOT_DECISION_MAKER = /counsel|credential|billing|insurance|compliance|specialist|coordinator|assistant|admin|secretary|clerk|analyst|accountant|payroll|revenue|finance|hr\b|human resources/i

interface NpiResult {
  number: string
  basic?: { organization_name?: string; status?: string; authorized_official_first_name?: string; authorized_official_last_name?: string; authorized_official_title_or_position?: string; authorized_official_credential?: string }
  addresses?: Array<{ address_purpose?: string; address_1?: string; address_2?: string; city?: string; state?: string; postal_code?: string; telephone_number?: string }>
  taxonomies?: Array<{ desc?: string; primary?: boolean }>
}

async function npiSearch(q: SourceQuery): Promise<SourcePage> {
  const taxonomy = q.niche ? NPI_TAXONOMY[q.niche.id] : ''
  if (!taxonomy) throw new Error('The NPI Registry only lists health practices (dentists, chiropractors, optometrists…)')
  const loc = parseUsLocation(q.location)
  const skip = Number(q.token || 0)
  const params = new URLSearchParams({ version: '2.1', enumeration_type: 'NPI-2', taxonomy_description: taxonomy, limit: '200', skip: String(skip) })
  if (loc.city) params.set('city', loc.city)
  if (loc.state) params.set('state', loc.state)
  if (loc.postal) params.set('postal_code', loc.postal)
  const res = await fetch(`https://npiregistry.cms.hhs.gov/api/?${params}`, { signal: AbortSignal.timeout(20_000), cache: 'no-store' })
  if (!res.ok) throw new Error(`NPI Registry HTTP ${res.status}`)
  const d = await res.json() as { results?: NpiResult[]; Errors?: Array<{ description?: string }> }
  if (d.Errors?.length) throw new Error(`NPI Registry: ${d.Errors[0].description || 'bad request'}`)
  const results = d.results || []
  const places = results.filter((r) => r.basic?.organization_name && r.basic.status === 'A').map((r): PlaceResult => {
    const a = r.addresses?.find((x) => x.address_purpose === 'LOCATION') || r.addresses?.[0] || {}
    const b = r.basic!
    const role = b.authorized_official_title_or_position || ''
    const official = [b.authorized_official_first_name, b.authorized_official_last_name].filter(Boolean).join(' ')
    const isOwner = !!official && (DECISION_MAKER.test(`${role} ${b.authorized_official_credential || ''}`)) && !NOT_DECISION_MAKER.test(role)
    const zip = (a.postal_code || '').slice(0, 5)
    return {
      placeId: `npi:${r.number}`, source: 'NPI', name: title(b.organization_name),
      types: (r.taxonomies || []).map((t) => (t.desc || '').toLowerCase()).filter(Boolean),
      category: r.taxonomies?.find((t) => t.primary)?.desc || r.taxonomies?.[0]?.desc,
      address: [title([a.address_1, a.address_2].filter(Boolean).join(', ')), title(a.city), a.state, zip].filter(Boolean).join(', ') || undefined,
      city: title(a.city) || undefined, state: a.state, postalCode: zip || undefined, country: 'US',
      phone: a.telephone_number,
      mapsUrl: `https://npiregistry.cms.hhs.gov/provider-view/${r.number}`,
      businessStatus: 'OPERATIONAL',
      ownerName: isOwner ? title(official) : undefined,
      ownerTitle: isOwner ? title(role).slice(0, 60) || undefined : undefined,
    }
  })
  // The registry serves at most 1,200 rows per query
  const next = results.length === 200 && skip + 200 < 1200 && skip + 200 < q.max * 3 ? String(skip + 200) : null
  return { places, next }
}

// ─── TomTom ──────────────────────────────────────────────────────────────────

interface TomTomResult {
  id: string
  poi?: { name?: string; phone?: string; url?: string; categories?: string[] }
  address?: { freeformAddress?: string; municipality?: string; countrySubdivisionCode?: string; countrySubdivision?: string; postalCode?: string; countryCode?: string }
  position?: { lat?: number; lon?: number }
}

async function tomtomSearch(q: SourceQuery): Promise<SourcePage> {
  const box = await geocode(q.location, q.country)
  const ofs = Number(q.token || 0)
  const params = { limit: '100', ofs: String(ofs), topLeft: `${box.north},${box.west}`, btmRight: `${box.south},${box.east}`, ...(q.country ? { countrySet: q.country } : {}) }
  const d = await withKey('tomtom', async (key) => {
    const res = await fetch(`https://api.tomtom.com/search/2/poiSearch/${encodeURIComponent(q.query)}.json?${new URLSearchParams({ ...params, key })}`, { signal: AbortSignal.timeout(20_000), cache: 'no-store' })
    if (!res.ok) throw rejection(res.status, await res.text().catch(() => '')) || new Error(`TomTom HTTP ${res.status}`)
    return await res.json() as { summary?: { totalResults?: number }; results?: TomTomResult[] }
  })
  const places = (d.results || []).filter((r) => r.poi?.name).map((r): PlaceResult => ({
    placeId: `tomtom:${r.id}`, source: 'TOMTOM', name: r.poi!.name!,
    types: (r.poi!.categories || []).map((c) => c.toLowerCase()),
    category: r.poi!.categories?.[0],
    address: r.address?.freeformAddress, city: r.address?.municipality,
    state: r.address?.countrySubdivisionCode || r.address?.countrySubdivision, postalCode: r.address?.postalCode?.split(',')[0], country: r.address?.countryCode,
    lat: r.position?.lat, lng: r.position?.lon,
    phone: r.poi!.phone,
    website: r.poi!.url ? (/^https?:\/\//i.test(r.poi!.url) ? r.poi!.url : `https://${r.poi!.url}`) : undefined,
    businessStatus: 'OPERATIONAL',
  }))
  const total = Math.min(d.summary?.totalResults || 0, 1900)
  return { places, next: ofs + 100 < total && ofs + 100 < q.max * 2 ? String(ofs + 100) : null }
}

// ─── Foursquare ──────────────────────────────────────────────────────────────

interface FsqPlace {
  fsq_place_id?: string; name?: string; latitude?: number; longitude?: number; tel?: string; website?: string; email?: string; date_closed?: string
  location?: { address?: string; locality?: string; region?: string; postcode?: string; country?: string; formatted_address?: string }
  categories?: Array<{ name?: string }>
  social_media?: { facebook_id?: string; instagram?: string }
}

async function foursquareSearch(q: SourceQuery): Promise<SourcePage> {
  const params = new URLSearchParams({
    query: q.query, near: q.location, limit: '50',
    fields: 'fsq_place_id,name,location,categories,tel,website,email,social_media,latitude,longitude,date_closed',
  })
  if (q.token) params.set('cursor', q.token)
  const { body, link } = await withKey('foursquare', async (key) => {
    const res = await fetch(`https://places-api.foursquare.com/places/search?${params}`, {
      headers: { Authorization: `Bearer ${key}`, 'X-Places-Api-Version': '2025-06-17', Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000), cache: 'no-store',
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (res.status === 400 && /geocod|near/i.test(text)) return { body: { results: [] as FsqPlace[] }, link: '' } // place name it can't locate
      throw rejection(res.status, text) || new Error(`Foursquare HTTP ${res.status}`)
    }
    return { body: await res.json() as { results?: FsqPlace[] }, link: res.headers.get('link') || '' }
  })
  const places = (body.results || []).filter((p) => p.fsq_place_id && p.name).map((p): PlaceResult => ({
    placeId: `fsq:${p.fsq_place_id}`, source: 'FOURSQUARE', name: p.name!,
    types: (p.categories || []).map((c) => (c.name || '').toLowerCase()).filter(Boolean),
    category: p.categories?.[0]?.name,
    address: p.location?.formatted_address || p.location?.address, city: p.location?.locality, state: p.location?.region,
    postalCode: p.location?.postcode, country: p.location?.country,
    lat: p.latitude, lng: p.longitude, phone: p.tel, website: p.website, email: p.email,
    mapsUrl: `https://foursquare.com/v/${p.fsq_place_id}`,
    facebook: p.social_media?.facebook_id ? `https://www.facebook.com/${p.social_media.facebook_id}` : undefined,
    instagram: p.social_media?.instagram ? `https://www.instagram.com/${p.social_media.instagram}` : undefined,
    businessStatus: p.date_closed ? 'CLOSED_PERMANENTLY' : 'OPERATIONAL',
  }))
  const cursor = link.match(/[?&]cursor=([^&>]+)[^>]*>;\s*rel="next"/)?.[1]
  return { places, next: cursor && places.length ? decodeURIComponent(cursor) : null }
}

// ─── Registry ────────────────────────────────────────────────────────────────

/** Results per page, so the pipeline knows when a location has given enough */
export const PAGE_SIZE: Record<SourceId, number> = { GOOGLE: 20, FOURSQUARE: 50, TOMTOM: 100, NPI: 200, OSM: Infinity }

export function sourceConfigured(id: SourceId) {
  if (id === 'GOOGLE') return googleConfigured()
  if (id === 'FOURSQUARE') return configured('foursquare')
  if (id === 'TOMTOM') return configured('tomtom')
  return true // NPI and OSM need no key
}

/** Why this source can't run this search (null = it can) */
export function sourceProblem(id: SourceId, niche: Niche | null, country?: string | null): string | null {
  if (!sourceConfigured(id)) return `${SOURCE_LABEL[id]} has no API key yet`
  if (id === 'OSM' && !niche?.osm.length) return 'OpenStreetMap needs a niche from the list'
  if (id === 'NPI') {
    if (!niche || !NPI_TAXONOMY[niche.id]) return 'The NPI Registry only lists health practices (dentists, chiropractors, optometrists, physical therapy, dermatology)'
    if (country && country.toUpperCase() !== 'US') return 'The NPI Registry only covers the United States'
  }
  return null
}

/** Every source that applies to this search and can take a call right now, richest data first */
export async function sourcesFor(niche: Niche | null, country?: string | null): Promise<SourceId[]> {
  const out: SourceId[] = []
  for (const id of ['GOOGLE', 'FOURSQUARE', 'TOMTOM', 'NPI', 'OSM'] as SourceId[]) {
    if (sourceProblem(id, niche, country)) continue
    if (id === 'GOOGLE' && (await googleUsage()) >= (await getFinderSettings()).googleMonthlyCap) continue
    if (id === 'FOURSQUARE' && !(await available('foursquare'))) continue
    if (id === 'TOMTOM' && !(await available('tomtom'))) continue
    out.push(id)
  }
  return out
}

/** One page from one source */
export async function searchSource(id: SourceId, q: SourceQuery): Promise<SourcePage> {
  if (id === 'GOOGLE') {
    const res = await googleTextSearch(`${q.query}${q.location ? ` in ${q.location}` : ''}`, { pageToken: q.token, regionCode: q.country })
    return { places: res.places, next: res.nextPageToken }
  }
  if (id === 'OSM') {
    // No ranking on OSM: the ones we can actually reach (email / site / phone) first
    const all = await osmSearch(q.niche?.osm || [], q.location, q.country, Math.min(q.max * 4, 400))
    const reach = (p: PlaceResult) => (p.email ? 4 : 0) + (p.website ? 2 : 0) + (p.phone ? 1 : 0)
    return { places: all.sort((a, b) => reach(b) - reach(a)).slice(0, q.max), next: null }
  }
  if (id === 'NPI') return npiSearch(q)
  if (id === 'TOMTOM') return tomtomSearch(q)
  return foursquareSearch(q)
}
