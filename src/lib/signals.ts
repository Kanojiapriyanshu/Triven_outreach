// Turns a lead's free-text research ("Mon-Thu 8-5, Fri-Sun CLOSED; Dr. Neely nominated
// Best of Boise 2026") into facts the email templates can use. Pure, browser-safe.

export interface SignalSource {
  companyName?: string | null
  companyEmail?: string | null
  fullName?: string | null
  city?: string | null
  industry?: string | null
  whyThisLead?: string | null
  notes?: string | null
  personalizationNotes?: string | null
}

export interface LeadSignals {
  doctorName: string        // "Dr. Neely"
  closedDays: string        // "Friday to Sunday" | "weekends" | "Fridays and Sundays"
  closedDayCount: number
  aClosedDay: string        // "Saturday": for "call it on a Saturday"
  closingTime: string       // "5pm"
  closesEarly: boolean      // closes at 6pm or earlier
  isNewPractice: boolean
  rating: string            // "4.9 stars from 300 reviews"
  award: string             // "Best of Boise 2026"
  acceptingNewPatients: boolean
  extendedHours: boolean    // evenings / Saturdays / 7 days
  roleInbox: boolean        // receptionist@, info@, front1@ … (read by the front desk)
  openDays: number          // "only open 4 days/week" → 4
  phoneOverwhelm: boolean   // site says "skip the phone call, text us"
  newPatientPromo: boolean  // gift cards / free whitening for new patients
  cdcp: boolean             // Canadian Dental Care Plan
  emergency: boolean
  locations: number         // 2+ = multi-location
  since: string             // "since 1994" / "for 15+ years"
  topRated: boolean         // "top-rated by Google users"
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const ROLE_INBOX = /^(info|office|front|reception|receptionist|hello|contact|admin|appointments?|appts?|team|care|smiles?|mail|enquir|inquir|patients?|scheduling|schedule|booking|dental|dentist)/i

function dayIndex(s: string) {
  return DAYS.indexOf(s.slice(0, 3).toLowerCase())
}

function findDoctor(src: SignalSource, text: string) {
  const full = src.fullName?.trim()
  if (full && /^dr\.?\s/i.test(full)) return `Dr. ${full.split(/\s+/).pop()}`
  // "Dr. Neely", "Dr. Preet Kulaar" → surname
  const dr = text.match(/\bDr\.?\s+([A-Z][a-zA-Z'’-]+)(?:\s+([A-Z][a-zA-Z'’-]+))?/)
  if (dr) return `Dr. ${dr[2] || dr[1]}`
  // "Michael Smith DMD", "Jane Doe, DDS"
  const deg = text.match(/\b([A-Z][a-z]+)\s+([A-Z][a-zA-Z'’-]+),?\s+(?:DMD|DDS|BDS)\b/)
  if (deg) return `Dr. ${deg[2]}`
  return ''
}

function findClosed(text: string) {
  // "Fri-Sun CLOSED", "Sat-Sun closed", "Fri/Sun CLOSED"
  const range = text.match(/\b(mon|tue|wed|thu|fri|sat|sun)\w*\s*[-–]\s*(mon|tue|wed|thu|fri|sat|sun)\w*\s+closed/i)
  if (range) {
    const a = dayIndex(range[1]), b = dayIndex(range[2])
    if (a >= 0 && b >= a) {
      const count = b - a + 1
      if (a === 5 && b === 6) return { phrase: 'weekends', count: 2, day: 'Saturday' }
      return { phrase: `${DAY_NAMES[a]} to ${DAY_NAMES[b]}`, count, day: DAY_NAMES[b === 6 ? 5 : b] }
    }
  }
  const pair = text.match(/\b(mon|tue|wed|thu|fri|sat|sun)\w*\s*\/\s*(mon|tue|wed|thu|fri|sat|sun)\w*\s+closed/i)
  if (pair) {
    const a = dayIndex(pair[1]), b = dayIndex(pair[2])
    return { phrase: `${DAY_NAMES[a]}s and ${DAY_NAMES[b]}s`, count: 2, day: DAY_NAMES[b] }
  }
  if (/closed (on )?weekends|weekends?\s+closed|no weekend/i.test(text)) return { phrase: 'weekends', count: 2, day: 'Saturday' }
  if (/sun(day)?\s+closed|closed (on )?sundays?/i.test(text)) return { phrase: 'Sundays', count: 1, day: 'Sunday' }
  return null
}

/** Usual weekday closing time: the hours block covering the most days wins ("Mon 7-4, Tue-Thu 8-5" → 5pm) */
function findClosingTime(text: string) {
  const re = /\b(mon|tue|wed|thu|fri)\w*((?:\s*[-/–]\s*(?:mon|tue|wed|thu|fri|sat|sun)\w*)*)\s+(\d{1,2})(?::\d{2})?\s*(?:am)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?/gi
  // Total days per closing time; most days wins, ties go to the later (safer) time
  const byEnd = new Map<string, { days: number; end: number; minutes: string }>()
  for (const m of text.matchAll(re)) {
    const first = dayIndex(m[1])
    const rest = [...(m[2] || '').matchAll(/(mon|tue|wed|thu|fri|sat|sun)/gi)].map((x) => dayIndex(x[1]))
    const isRange = /[-–]/.test(m[2] || '')
    const days = rest.length === 0 ? 1 : isRange ? Math.max(1, rest[rest.length - 1] - first + 1) : rest.length + 1
    let end = Number(m[4])
    if (end < 12) end += 12 // "8-5" means 5pm
    const minutes = m[5] ? `:${m[5]}` : ''
    const key = `${end}${minutes}`
    const prev = byEnd.get(key)
    byEnd.set(key, { days: (prev?.days || 0) + days, end, minutes })
  }
  const best = [...byEnd.values()].sort((a, b) => b.days - a.days || b.end - a.end)[0]
  if (!best) return null
  return { label: `${best.end > 12 ? best.end - 12 : best.end}${best.minutes}pm`, hour: best.end }
}

/** "Ingalls Family Dental (Dr. Preet Kulaar)" → "Ingalls Family Dental" */
export function cleanCompanyName(name?: string | null) {
  // A free-mail domain ("gmail.com") is never a company name
  if (/^(gmail|googlemail|yahoo|outlook|hotmail|icloud|aol|proton|protonmail|live|msn|me)\.[a-z.]+$/i.test((name || '').trim())) return ''
  return (name || '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/,?\s+(inc|llc|ltd|limited|pllc|pc|p\.c|corp|co)\.?$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function extractSignals(src: SignalSource): LeadSignals {
  const text = [src.whyThisLead, src.notes, src.personalizationNotes, src.companyName, src.fullName]
    .filter(Boolean).join(' . ')
  const closed = findClosed(text)
  const closing = findClosingTime(text)
  const local = (src.companyEmail || '').split('@')[0] || ''

  const rating = text.match(/(\d\.\d)\s*(?:★|stars?|rating)?\s*[/,]?\s*(?:from\s+)?(\d{2,5})\+?\s*(?:google\s+)?reviews/i)
  const award = text.match(/\b(?:nominated|voted|named|won|winner of)\s+(?:for\s+)?(Best of [A-Z][\w.'’ ]*?\d{4}|Best of [A-Z][\w'’]+|Top Dentist[\w ]*?\d{4})/i)

  return {
    doctorName: findDoctor(src, text),
    closedDays: closed?.phrase || '',
    closedDayCount: closed?.count || 0,
    aClosedDay: closed?.day || '',
    closingTime: closing?.label || '',
    closesEarly: !!closing && closing.hour <= 17,
    isNewPractice: /brand new|opened (in )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+20\d\d|new practice|startup|just opened/i.test(text),
    rating: rating ? `${rating[1]} stars from ${rating[2]} reviews` : '',
    award: award ? award[1].trim() : '',
    acceptingNewPatients: /accepting new patients/i.test(text),
    extendedHours: /evening|saturday appointments|saturdays|7 days|extended hours/i.test(text) && !closed,
    roleInbox: ROLE_INBOX.test(local) && !/gmail|yahoo|hotmail|outlook|icloud|aol/i.test(src.companyEmail || ''),
    openDays: Number(text.match(/only open (\d) days/i)?.[1] || 0),
    phoneOverwhelm: /skip the (phone )?call|text us|phone overwhelm/i.test(text),
    newPatientPromo: /gift card|free whitening|new.patient (offer|special|acquisition)|\$\d+ off/i.test(text),
    cdcp: /\bCDCP\b/.test(text),
    emergency: /emergency/i.test(text),
    locations: Number(text.match(/(\d+)\s+(?:\w+\s+)?locations/i)?.[1] || (/also has .{0,40}location|multi.location/i.test(text) ? 2 : 0)),
    since: (() => {
      const y = text.match(/since (19\d\d|20[01]\d)/i)?.[1]
      if (y) return `since ${y}`
      const yrs = text.match(/(\d{2})\+?\s*(?:yrs|years)/i)?.[1]
      return yrs && Number(yrs) >= 10 ? `for ${yrs}+ years` : ''
    })(),
    topRated: /top.rated/i.test(text),
  }
}

/**
 * Personal template variables built from the signals.
 * Everything degrades to a natural sentence (or disappears) when a fact is unknown.
 */
export function signalVars(src: SignalSource, firstName: string): Record<string, string> {
  const s = extractSignals(src)
  const company = cleanCompanyName(src.companyName) || 'your practice'
  const isDental = /dent|ortho|smile/i.test(`${src.industry} ${company} ${src.whyThisLead}`)
  const patients = isDental || /clinic|medical|spa|aesthetic|chiro|physio|vet/i.test(`${src.industry} ${company}`) ? 'patients' : 'customers'
  const hasCompany = !!cleanCompanyName(src.companyName)
  // "Harrison Dental team"; with no company name at all, never "your practice team"
  const team = hasCompany ? `${company} team` : 'there'

  // Who we're talking to: the front desk reads role inboxes, so greet the team there
  const name = s.roleInbox ? (hasCompany ? team : (s.doctorName || 'there')) : (s.doctorName || firstName || team)

  // 1. A genuine compliment first, when the research gives us one
  const praise = s.award
    ? `Congrats on the ${s.award} nomination${s.doctorName ? ` for ${s.doctorName}` : ''}.`
    : s.rating ? `${s.rating} is rare, and it usually means the phone at ${company} rarely stops.`
    : s.topRated ? `${company} being one of the top-rated practices on Google${src.city ? ` in ${src.city}` : ''} usually means a busy phone.`
    : s.since ? `Running an independent practice ${s.since} is rare these days.`
    : ''

  // 2. Then the one observation that makes the problem theirs (strongest signal wins)
  const when = s.closedDays === 'weekends' ? 'on weekends' : `on ${s.closedDays}`
  const gap =
    s.isNewPractice
      ? `Congrats on opening ${company} this year. In the first year the phone usually gets busy before the front desk is fully staffed.`
    : s.closedDayCount >= 3
      ? `I noticed you're closed ${s.closedDays}, so for three days a week anyone calling to book gets voicemail${s.acceptingNewPatients ? ', right while you\'re taking new patients' : ''}.`
    : s.openDays && s.openDays <= 4
      ? `I noticed you're only open ${s.openDays} days a week, so for the other ${7 - s.openDays} anyone calling to book gets voicemail.`
    : s.closedDays
      ? isDental
        ? `I noticed you're closed ${when}, which is exactly when a lot of people with a toothache start looking for a dentist.`
        : `I noticed you're closed ${when}, which is exactly when a lot of people finally get round to calling.`
    : s.phoneOverwhelm
      ? `I saw your site asks ${patients} to text rather than call, which usually means the phones are hard to keep up with.`
    : s.newPatientPromo
      ? `I saw the new-patient offers on your site. Every call that rings out after one of those is marketing spend walking away.`
    : s.closesEarly
      ? `I noticed you close at ${s.closingTime}, right when most ${patients} finish work and start making calls.`
    : s.cdcp
      ? `With CDCP bringing a wave of new patients into the system, most practices I speak to have seen their phones get noticeably busier.`
    : s.locations >= 2
      ? `Running more than one location usually means the phones never really stop, and calls slip through between sites.`
    : s.emergency
      ? `Since you offer emergency care, the calls that matter most often come in when the team is busy or the practice is closed.`
    : s.extendedHours
      ? `Your evening and weekend hours show ${company} is built around ${patients}' schedules. The catch is that the busiest phone times are also when your team is busiest with patients.`
    : s.acceptingNewPatients
      ? `I saw ${company} is accepting new patients, which also means every missed call is a new patient lost.`
    : src.city
      ? `I was looking at independent ${isDental ? 'practices' : 'businesses'} in ${src.city} and ${company} came up.`
    : ''
  const hook = [praise, gap].filter(Boolean).join(' ')

  // FU2: their gap in numbers
  const gapLine = s.closedDayCount >= 3
    ? `You're closed ${s.closedDays}, so for about ${Math.round((s.closedDayCount / 7) * 100)}% of the week nobody is there to pick up.`
    : s.openDays && s.openDays <= 4
      ? `Being open ${s.openDays} days means for about ${Math.round(((7 - s.openDays) / 7) * 100)}% of the week nobody is there to pick up.`
    : s.closedDays
      ? `${s.closedDays === 'weekends' ? 'Weekends alone are' : `${s.closedDays} alone are`} ${s.closedDayCount >= 2 ? 'almost 30%' : 'about 14%'} of the week, before you count evenings and lunch breaks.`
    : s.closesEarly
      ? `Closing at ${s.closingTime} means the calls from people finishing work all go unanswered.`
    : s.extendedHours
      ? `Even with your extended hours, calls that come in while everyone is with a patient, over lunch, or overnight still go unanswered.`
    : `Evenings, lunch breaks and weekends add up to more than half the hours in a week.`

  const forwardLine = s.roleInbox
    ? `If ${s.doctorName || 'the practice owner'} is the right person for this, would you mind passing it along?`
    : ''

  return {
    name,
    hook,
    gapLine,
    forwardLine,
    doctorName: s.doctorName,
    closedDays: s.closedDays,
    // "on weekends" / "on Sundays" / "from Friday to Sunday"
    closedWhen: !s.closedDays ? '' : s.closedDays.includes(' to ') ? `from ${s.closedDays}` : `on ${s.closedDays}`,
    closingTime: s.closingTime,
    testMoment: s.aClosedDay ? `on a ${s.aClosedDay} afternoon` : s.closingTime ? `at 7pm, after you've closed` : 'at 7pm tonight',
    practiceWish: s.isNewPractice ? 'with the new practice' : 'with the practice',
  }
}
