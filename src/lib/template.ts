// Template personalization shared by the browser (preview) and the server (sending).
// Keep this file free of server-only imports.
import { signalVars, cleanCompanyName } from './signals'

export interface TemplateLead {
  firstName?: string | null
  lastName?: string | null
  fullName?: string | null
  companyName?: string | null
  companyEmail?: string | null
  jobTitle?: string | null
  city?: string | null
  industry?: string | null
  website?: string | null
  personalizationNotes?: string | null
  whyThisLead?: string | null
  notes?: string | null
}

export interface TemplateSender {
  displayName?: string | null
  email?: string | null
}

export const TEMPLATE_VARS = [
  { key: 'name',            label: 'Smart greeting (Dr. Neely / team)' },
  { key: 'hook',            label: 'Personal opener from research' },
  { key: 'gapLine',         label: 'Their coverage gap' },
  { key: 'forwardLine',     label: 'Pass-along line (front desk)' },
  { key: 'firstName',       label: 'First name' },
  { key: 'lastName',        label: 'Last name' },
  { key: 'companyName',     label: 'Company' },
  { key: 'jobTitle',        label: 'Job title' },
  { key: 'city',            label: 'City' },
  { key: 'industry',        label: 'Industry' },
  { key: 'personalNote',    label: 'Personal note' },
  { key: 'senderName',      label: 'Your name' },
  { key: 'senderFirstName', label: 'Your first name' },
  { key: 'demoPhone',       label: 'Demo phone number' },
] as const

// Used when a variable has no value and the template gives no {{key|fallback}}
const DEFAULT_FALLBACKS: Record<string, (vars: Record<string, string>) => string> = {
  // "Hi Harrison Dental team," reads far better than "Hi there,"
  firstName: (v) => (v.companyName ? `${v.companyName} team` : 'there'),
  companyName: (v) => (/dent|ortho|clinic|medical|spa/i.test(v.industry) ? 'your practice' : 'your business'),
  city: () => 'your area',
}

// Parts of an email address that are never a person's name
const NOT_A_NAME = /^(info|office|front|frontdesk|reception|receptionist|hello|hi|contact|admin|appointments?|appts?|team|care|smiles?|mail|email|enquiries|inquiries|patients?|schedul\w*|booking|bookings|dental|dentist|dentistry|clinic|family|ortho|practice|support|sales|billing|accounts?|manager|marketing|help|noreply|no-reply|the|and|dr)$/i

/**
 * Best guess at a first name from an address, only for unambiguous patterns:
 * "john.smith@" → John, "sarah_k@" → Sarah, "drpatel@" / "dr.patel@" → Dr. Patel.
 * Anything else ("harrisondental@", "info@") returns nothing.
 */
export function nameFromEmail(email?: string | null): { firstName?: string; doctor?: string } {
  const local = (email || '').split('@')[0]?.toLowerCase().replace(/\d+$/, '') || ''
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)
  const dr = local.match(/^dr[._-]?([a-z]{3,15})$/)
  if (dr && !NOT_A_NAME.test(dr[1])) return { doctor: `Dr. ${cap(dr[1])}` }
  const parts = local.split(/[._-]/).filter(Boolean)
  if (parts.length >= 2 && /^[a-z]{2,15}$/.test(parts[0]) && !NOT_A_NAME.test(parts[0]) && !parts.some((p) => NOT_A_NAME.test(p))) {
    return { firstName: cap(parts[0]) }
  }
  return {}
}

export function buildTemplateVars(lead: TemplateLead, sender?: TemplateSender | null, extras: { demoPhone?: string } = {}): Record<string, string> {
  const nameParts = (lead.fullName || '').trim().split(/\s+/).filter(Boolean)
  const senderName = sender?.displayName || ''
  const fromEmail = !lead.firstName && !lead.fullName ? nameFromEmail(lead.companyEmail) : {}
  const firstName = lead.firstName || (/^dr\.?$/i.test(nameParts[0] || '') ? '' : nameParts[0]) || fromEmail.firstName || ''
  const leadForSignals = fromEmail.doctor ? { ...lead, fullName: fromEmail.doctor } : lead
  return {
    // Research-driven personalisation: {{name}}, {{hook}}, {{gapLine}}, {{forwardLine}} …
    ...signalVars(leadForSignals, firstName),
    firstName,
    lastName:        lead.lastName || nameParts.slice(1).join(' ') || '',
    fullName:        lead.fullName || [lead.firstName, lead.lastName].filter(Boolean).join(' '),
    companyName:     cleanCompanyName(lead.companyName),
    email:           lead.companyEmail || '',
    jobTitle:        lead.jobTitle || '',
    city:            lead.city || '',
    industry:        lead.industry || '',
    website:         lead.website || '',
    personalNote:    lead.personalizationNotes?.trim() || '',
    senderName,
    senderFirstName: senderName.split(/\s+/)[0] || '',
    senderEmail:     sender?.email || '',
    demoPhone:       extras.demoPhone?.trim() || '',
  }
}

/**
 * Replace {{key}} and {{key|fallback}} placeholders. Unknown keys are left untouched.
 * Lines left empty by a missing optional value (e.g. {{personalNote}}) are collapsed.
 */
export function renderTemplate(text: string, vars: Record<string, string>) {
  const seed = vars.email || vars.companyName || ''
  let spin = 0
  // {{#if key}}shown when key has a value{{else}}otherwise{{/if}}, nesting allowed:
  // resolve the innermost blocks (no #if inside them) first, until none are left
  const innermostIf = /\{\{#if\s+(\w+)\s*\}\}((?:(?!\{\{#if)[\s\S])*?)(?:\{\{else\}\}((?:(?!\{\{#if)[\s\S])*?))?\{\{\/if\}\}/g
  let resolved = text
  for (let i = 0; i < 10 && resolved.includes('{{#if'); i++) {
    resolved = resolved.replace(innermostIf, (_, key: string, yes: string, no?: string) => (vars[key]?.trim() ? yes : no ?? ''))
  }
  return resolved
    .replace(/\{\{\s*(\w+)\s*(?:\|([^}]*))?\}\}/g, (match, key: string, fallback?: string) => {
      if (!(key in vars)) return match
      return vars[key] || fallback?.trim() || DEFAULT_FALLBACKS[key]?.(vars) || ''
    })
    // Spintax {a|b|c}: each lead gets its own (stable) wording, so no two emails are identical
    .replace(/\{([^{}]*\|[^{}]*)\}/g, (_, options: string) => {
      const choices = options.split('|')
      return choices[hash(`${seed}#${spin++}#${options}`) % choices.length]
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** FNV-1a: small, stable string hash for seeding spintax */
function hash(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Best-effort company name from an email domain: "jane@brightsmile-dental.com" → "Brightsmile Dental" */
export function guessCompanyFromEmail(email: string) {
  const domain = email.split('@')[1]?.toLowerCase() || ''
  const free = ['gmail', 'yahoo', 'outlook', 'hotmail', 'icloud', 'aol', 'proton', 'protonmail', 'live', 'msn']
  const root = domain.split('.')[0] || ''
  if (!root || free.includes(root)) return ''
  return root.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

export type FollowUpType = 'FOLLOW_UP_1' | 'FOLLOW_UP_2' | 'FOLLOW_UP_3'
export const FOLLOW_UP_TYPES: FollowUpType[] = ['FOLLOW_UP_1', 'FOLLOW_UP_2', 'FOLLOW_UP_3']

export interface PickableTemplate {
  id: string
  type: string
  campaignId?: string | null
  isDefault?: boolean
}

/** Best template of a type: campaign default → campaign any → global default → global any */
export function pickDefaultTemplate<T extends PickableTemplate>(templates: T[], type: string, campaignId?: string | null): T | undefined {
  const ofType = templates.filter(t => t.type === type)
  return (
    (campaignId && ofType.find(t => t.campaignId === campaignId && t.isDefault)) ||
    (campaignId && ofType.find(t => t.campaignId === campaignId)) ||
    ofType.find(t => !t.campaignId && t.isDefault) ||
    ofType.find(t => !t.campaignId) ||
    undefined
  )
}


export interface LeadCheck { level: 'ok' | 'thin' | 'blocked'; notes: string[] }

/** How well can we personalise for this lead? Shown before bulk sends. */
export function checkLeadData(lead: TemplateLead & { companyEmail?: string | null }, vars: Record<string, string>): LeadCheck {
  const notes: string[] = []
  if (!lead.companyEmail) return { level: 'blocked', notes: ['No email address'] }
  if (!vars.companyName) notes.push('No company name: says "your practice"')
  if (!vars.firstName && !vars.doctorName) notes.push(vars.companyName ? `No contact name: greets "${vars.companyName} team"` : 'No name or company: greets "there"')
  if (!vars.hook || /^I was looking at/.test(vars.hook)) notes.push('No research: generic opening line')
  if (!vars.city) notes.push('No city')
  return { level: notes.length >= 2 ? 'thin' : 'ok', notes }
}
