// Spreadsheet → lead mapping, shared by the import wizard (auto-mapping) and the
// server (validation + import), so what you see is exactly what gets imported.
import { guessCompanyFromEmail } from './template'

export const IMPORT_FIELDS = [
  { value: 'companyName', label: 'Company / Practice name' },
  { value: 'companyEmail', label: 'Email' },
  { value: 'firstName', label: 'First Name' },
  { value: 'lastName', label: 'Last Name' },
  { value: 'fullName', label: 'Full Name / Contact' },
  { value: 'jobTitle', label: 'Job Title' },
  { value: 'phone', label: 'Phone' },
  { value: 'website', label: 'Website' },
  { value: 'linkedIn', label: 'LinkedIn' },
  { value: 'industry', label: 'Industry' },
  { value: 'cityState', label: 'City, State (combined)' },
  { value: 'city', label: 'City' },
  { value: 'state', label: 'State' },
  { value: 'country', label: 'Country' },
  { value: 'companySize', label: 'Company Size' },
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
  { value: 'notes', label: 'Notes' },
  { value: 'personalizationNotes', label: 'Personal note (used in emails)' },
  { value: 'whyThisLead', label: 'Why this lead / Research' },
  { value: 'companyPainPoint', label: 'Pain Point' },
  { value: 'socialMediaNotes', label: 'Social links' },
  { value: 'senderAccount', label: 'Sender Gmail (email)' },
  { value: 'firstEmailSentAt', label: 'First Email Sent Date' },
] as const

export type ImportField = typeof IMPORT_FIELDS[number]['value']

// Fields that several columns may feed into (joined), everything else is one column only
const MULTI_FIELDS = new Set<string>(['notes', 'socialMediaNotes', 'whyThisLead'])

// Header patterns, most specific first. Headers are compared lower-case with symbols removed.
const RULES: Array<[RegExp, ImportField | '']> = [
  [/^(status|stage|leadstatus|finalstatus|overallstatus)$/, 'status'],
  [/^linkedin(url|link|profile)?$/, 'linkedIn'],
  [/^(facebook|instagram|twitter|tiktok|social)(url|link|page|profile)?$/, 'socialMediaNotes'],
  // Per-channel tracking columns ("Email — Status", "DM — Date Reached", "Thread Link") are not lead data
  [/(status|date|thread|reached|sent|link)$/, ''],
  [/^(email|emailaddress|mail|contactemail|workemail|businessemail|primaryemail)$/, 'companyEmail'],
  [/email/, 'companyEmail'],
  [/^(company|companyname|business|businessname|practice|practicename|clinic|clinicname|organisation|organization|account|accountname|name of business)$/, 'companyName'],
  [/(company|business|practice|clinic|organi[sz]ation|firm|agency)/, 'companyName'],
  [/^(firstname|first|fname|givenname)$/, 'firstName'],
  [/^(lastname|last|lname|surname|familyname)$/, 'lastName'],
  [/^(fullname|name|contact|contactname|owner|ownername|decisionmaker|doctor|dentist)$/, 'fullName'],
  [/(jobtitle|title|role|position)/, 'jobTitle'],
  [/(phone|mobile|cell|tel)/, 'phone'],
  [/(website|url|domain|site)/, 'website'],
  [/linkedin/, 'linkedIn'],
  [/(industry|sector|niche|vertical|category)/, 'industry'],
  [/(citystate|location|address|area)/, 'cityState'],
  [/^(city|town)$/, 'city'],
  [/^(state|province|region|county)$/, 'state'],
  [/country/, 'country'],
  [/(size|employees|headcount)/, 'companySize'],
  [/priority|tier/, 'priority'],
  [/(personal|icebreaker|opener|hook)/, 'personalizationNotes'],
  [/(hours|openinghours|businesshours|officehours|timings?)/, 'whyThisLead'],
  [/(reviews?|rating|awards?)/, 'whyThisLead'],
  [/(why|intent|research|signal|reason)/, 'whyThisLead'],
  [/pain/, 'companyPainPoint'],
  [/(facebook|instagram|twitter|tiktok|social)/, 'socialMediaNotes'],
  [/(sender|fromaccount|gmail)/, 'senderAccount'],
  [/^(status|stage|leadstatus|finalstatus)$/, 'status'],
  [/note|comment/, 'notes'],
]

function normalizeHeader(h: string) {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Map spreadsheet headers to lead fields; each single-value field is used once. */
export function autoMapColumns(columns: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  const used = new Set<string>()
  for (const col of columns) {
    const h = normalizeHeader(col)
    let field = ''
    for (const [re, f] of RULES) {
      if (re.test(h)) { field = f; break }
    }
    // "City / State" style headers
    if (/city/.test(h) && /state/.test(h)) field = 'cityState'
    if (field && !MULTI_FIELDS.has(field) && used.has(field)) field = ''
    if (field) used.add(field)
    mapping[col] = field
  }
  return mapping
}

/** Fields that are mapped from more than one column when they shouldn't be */
export function duplicateTargets(mapping: Record<string, string>) {
  const counts = new Map<string, number>()
  for (const f of Object.values(mapping)) if (f) counts.set(f, (counts.get(f) || 0) + 1)
  return [...counts].filter(([f, n]) => n > 1 && !MULTI_FIELDS.has(f)).map(([f]) => f)
}

const PRIORITY_MAP: Record<string, string> = {
  p0: 'URGENT', p1: 'HIGH', p2: 'MEDIUM', p3: 'LOW', p4: 'LOW',
  urgent: 'URGENT', critical: 'URGENT', hot: 'URGENT', high: 'HIGH', a: 'HIGH',
  medium: 'MEDIUM', med: 'MEDIUM', normal: 'MEDIUM', warm: 'MEDIUM', b: 'MEDIUM',
  low: 'LOW', cold: 'LOW', c: 'LOW',
}

export function normalizePriority(v?: string) {
  if (!v) return undefined
  return PRIORITY_MAP[v.trim().toLowerCase()] || undefined
}

/** Free-text spreadsheet status → CRM status (unknown → NEW) */
export function normalizeStatus(v?: string) {
  const s = (v || '').trim().toLowerCase()
  if (!s) return 'NEW'
  if (/not\s*(contacted|sent|started)|^new$|^todo|^to do|^pending/.test(s)) return 'NEW'
  if (/unsub|opt.?out/.test(s)) return 'UNSUBSCRIBED'
  if (/bounce|invalid/.test(s)) return 'INVALID_EMAIL'
  if (/not\s*interested|declined/.test(s)) return 'NOT_INTERESTED'
  if (/do\s*not|dnc/.test(s)) return 'DO_NOT_CONTACT'
  if (/interested|warm/.test(s)) return 'INTERESTED'
  if (/replied|responded|reply/.test(s)) return 'REPLIED'
  if (/meeting|booked|call scheduled/.test(s)) return 'MEETING_BOOKED'
  if (/won|closed|customer|client/.test(s)) return 'WON'
  if (/lost/.test(s)) return 'LOST'
  if (/ready/.test(s)) return 'READY_TO_CONTACT'
  if (/research/.test(s)) return 'RESEARCHING'
  return 'NEW'
}

function cleanWebsite(v?: string) {
  const w = (v || '').trim()
  if (!w) return undefined
  return w.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '')
}

function firstEmail(v?: string) {
  return (v || '').match(/[\w.+'-]+@[\w-]+(\.[\w-]+)+/)?.[0]?.toLowerCase()
}

export interface MappedLead {
  data: Record<string, string | undefined>
  senderEmail?: string
  warnings: string[]
  errors: string[]
}

/** Turn one spreadsheet row into clean lead fields. */
export function mapRow(raw: Record<string, unknown>, mapping: Record<string, string>): MappedLead {
  const collected: Record<string, string[]> = {}
  for (const [col, field] of Object.entries(mapping)) {
    const value = raw[col] == null ? '' : String(raw[col]).trim()
    if (!field || !value) continue
    ;(collected[field] ||= []).push(value)
  }
  const one = (f: string) => collected[f]?.[0]
  const joined = (f: string, sep = '\n') => collected[f]?.join(sep)

  const email = firstEmail(one('companyEmail'))
  const website = cleanWebsite(one('website'))
  let firstName: string | undefined = one('firstName')
  let lastName: string | undefined = one('lastName')
  const fullName = one('fullName')
  if (!firstName && fullName && !/[&,]/.test(fullName)) {
    const parts = fullName.replace(/^(dr|mr|mrs|ms|miss)\.?\s+/i, '').split(/\s+/)
    firstName = parts[0]
    lastName = lastName || parts.slice(1).join(' ') || undefined
  }

  let city: string | undefined = one('city')
  let state: string | undefined = one('state')
  const cityState = one('cityState')
  if (cityState) {
    const [c, s] = cityState.split(',').map((x) => x.trim())
    city = city || c || undefined
    state = state || s || undefined
  }

  const companyName = one('companyName')
    || (email ? guessCompanyFromEmail(email) : '')
    || (website ? website.split('.')[0] : '')
    || undefined

  const warnings: string[] = []
  const errors: string[] = []
  if (!email) warnings.push('No email')
  if (one('companyEmail') && !email) warnings.push(`Unreadable email "${one('companyEmail')}"`)
  if (!companyName && !email) errors.push('Row has no company name or email')

  return {
    data: {
      companyName,
      companyEmail: email,
      firstName,
      lastName,
      fullName: fullName || [firstName, lastName].filter(Boolean).join(' ') || undefined,
      jobTitle: one('jobTitle'),
      phone: one('phone'),
      website,
      linkedIn: one('linkedIn'),
      industry: one('industry'),
      city,
      state,
      country: one('country'),
      companySize: one('companySize'),
      priority: normalizePriority(one('priority')),
      status: normalizeStatus(one('status')),
      notes: joined('notes'),
      personalizationNotes: one('personalizationNotes'),
      whyThisLead: joined('whyThisLead'),
      companyPainPoint: one('companyPainPoint'),
      socialMediaNotes: joined('socialMediaNotes'),
      firstEmailSentAt: one('firstEmailSentAt'),
    },
    senderEmail: one('senderAccount')?.toLowerCase(),
    warnings,
    errors,
  }
}
