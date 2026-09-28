// The recipient's timezone and business hours (PRD R7.1): first emails and follow-ups land
// 9:00–17:00 on the recipient's weekdays when their campaign asks for it. Browser-safe.
import type { SendWindow } from './send-window'

const US_STATES: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago', CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York', DC: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago', KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York', MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago', MS: 'America/Chicago', MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago', NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York', OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', UT: 'America/Denver', VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York', WI: 'America/Chicago', WY: 'America/Denver', PR: 'America/Puerto_Rico',
}
const CA_PROVINCES: Record<string, string> = {
  BC: 'America/Vancouver', AB: 'America/Edmonton', SK: 'America/Regina', MB: 'America/Winnipeg', ON: 'America/Toronto', QC: 'America/Toronto', NB: 'America/Moncton', NS: 'America/Halifax', PE: 'America/Halifax', NL: 'America/St_Johns', YT: 'America/Whitehorse', NT: 'America/Yellowknife', NU: 'America/Iqaluit',
}
const AU_STATES: Record<string, string> = {
  NSW: 'Australia/Sydney', VIC: 'Australia/Melbourne', QLD: 'Australia/Brisbane', WA: 'Australia/Perth', SA: 'Australia/Adelaide', TAS: 'Australia/Hobart', ACT: 'Australia/Sydney', NT: 'Australia/Darwin',
}
// One zone per country (the main business zone). Big multi-zone countries fall back here when no state is known.
const COUNTRIES: Record<string, string> = {
  US: 'America/New_York', CA: 'America/Toronto', GB: 'Europe/London', UK: 'Europe/London', IE: 'Europe/Dublin', AU: 'Australia/Sydney', NZ: 'Pacific/Auckland',
  IN: 'Asia/Kolkata', PK: 'Asia/Karachi', BD: 'Asia/Dhaka', LK: 'Asia/Colombo', NP: 'Asia/Kathmandu', AE: 'Asia/Dubai', SA: 'Asia/Riyadh', QA: 'Asia/Qatar', KW: 'Asia/Kuwait', BH: 'Asia/Bahrain', OM: 'Asia/Muscat', IL: 'Asia/Jerusalem', EG: 'Africa/Cairo',
  SG: 'Asia/Singapore', MY: 'Asia/Kuala_Lumpur', PH: 'Asia/Manila', ID: 'Asia/Jakarta', TH: 'Asia/Bangkok', VN: 'Asia/Ho_Chi_Minh', HK: 'Asia/Hong_Kong', JP: 'Asia/Tokyo', KR: 'Asia/Seoul', CN: 'Asia/Shanghai', TW: 'Asia/Taipei',
  ZA: 'Africa/Johannesburg', NG: 'Africa/Lagos', KE: 'Africa/Nairobi', GH: 'Africa/Accra', UG: 'Africa/Kampala', TZ: 'Africa/Dar_es_Salaam', ZW: 'Africa/Harare', ZM: 'Africa/Lusaka', RW: 'Africa/Kigali', ET: 'Africa/Addis_Ababa', MA: 'Africa/Casablanca',
  DE: 'Europe/Berlin', FR: 'Europe/Paris', NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', ES: 'Europe/Madrid', PT: 'Europe/Lisbon', IT: 'Europe/Rome', CH: 'Europe/Zurich', AT: 'Europe/Vienna', SE: 'Europe/Stockholm', NO: 'Europe/Oslo', DK: 'Europe/Copenhagen', FI: 'Europe/Helsinki', PL: 'Europe/Warsaw', CZ: 'Europe/Prague', RO: 'Europe/Bucharest', GR: 'Europe/Athens', TR: 'Europe/Istanbul', UA: 'Europe/Kyiv', MT: 'Europe/Malta', CY: 'Asia/Nicosia',
  BR: 'America/Sao_Paulo', MX: 'America/Mexico_City', AR: 'America/Argentina/Buenos_Aires', CO: 'America/Bogota', CL: 'America/Santiago', PE: 'America/Lima', JM: 'America/Jamaica', TT: 'America/Port_of_Spain', BS: 'America/Nassau', BB: 'America/Barbados',
}
const NAMES: Record<string, string> = {
  'united states': 'US', usa: 'US', 'united kingdom': 'GB', england: 'GB', scotland: 'GB', wales: 'GB', canada: 'CA', australia: 'AU', 'new zealand': 'NZ', ireland: 'IE', india: 'IN', 'south africa': 'ZA', singapore: 'SG', 'united arab emirates': 'AE', uae: 'AE', germany: 'DE', france: 'FR', netherlands: 'NL', spain: 'ES', philippines: 'PH', nigeria: 'NG', kenya: 'KE', pakistan: 'PK',
}

export function timezoneFor(country?: string | null, state?: string | null) {
  const raw = (country || '').trim()
  const cc = raw.length === 2 ? raw.toUpperCase() : NAMES[raw.toLowerCase()] || ''
  const st = (state || '').trim().toUpperCase()
  if (cc === 'US' || (!cc && US_STATES[st])) return US_STATES[st] || (cc ? COUNTRIES.US : null)
  if (cc === 'CA') return CA_PROVINCES[st] || COUNTRIES.CA
  if (cc === 'AU') return AU_STATES[st] || COUNTRIES.AU
  return COUNTRIES[cc] || null
}

/** 9:00–17:00, Monday–Friday, in the recipient's zone (null when their zone is unknown) */
export function recipientWindow(country?: string | null, state?: string | null): SendWindow | null {
  const tz = timezoneFor(country, state)
  return tz ? { timezone: tz, start: '09:00', end: '17:00', skipWeekends: true } : null
}
