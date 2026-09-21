// Template personalization shared by the browser (preview) and the server (sending).
// Keep this file free of server-only imports.

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
}

export interface TemplateSender {
  displayName?: string | null
  email?: string | null
}

export const TEMPLATE_VARS = [
  { key: 'firstName',       label: 'First name' },
  { key: 'lastName',        label: 'Last name' },
  { key: 'companyName',     label: 'Company' },
  { key: 'jobTitle',        label: 'Job title' },
  { key: 'city',            label: 'City' },
  { key: 'industry',        label: 'Industry' },
  { key: 'senderName',      label: 'Your name' },
  { key: 'senderFirstName', label: 'Your first name' },
] as const

// Used when a variable has no value and the template gives no {{key|fallback}}
const DEFAULT_FALLBACKS: Record<string, string> = {
  firstName: 'there',
  companyName: 'your team',
}

export function buildTemplateVars(lead: TemplateLead, sender?: TemplateSender | null): Record<string, string> {
  const nameParts = (lead.fullName || '').trim().split(/\s+/).filter(Boolean)
  const senderName = sender?.displayName || ''
  return {
    firstName:       lead.firstName || nameParts[0] || '',
    lastName:        lead.lastName || nameParts.slice(1).join(' ') || '',
    fullName:        lead.fullName || [lead.firstName, lead.lastName].filter(Boolean).join(' '),
    companyName:     lead.companyName || '',
    email:           lead.companyEmail || '',
    jobTitle:        lead.jobTitle || '',
    city:            lead.city || '',
    industry:        lead.industry || '',
    website:         lead.website || '',
    senderName,
    senderFirstName: senderName.split(/\s+/)[0] || '',
    senderEmail:     sender?.email || '',
  }
}

/** Replace {{key}} and {{key|fallback}} placeholders. Unknown keys are left untouched. */
export function renderTemplate(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{\s*(\w+)\s*(?:\|([^}]*))?\}\}/g, (match, key: string, fallback?: string) => {
    if (!(key in vars)) return match
    return vars[key] || fallback?.trim() || DEFAULT_FALLBACKS[key] || ''
  })
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

/** Move a date that lands on a weekend to the following Monday (same time of day). */
export function skipWeekend(date: Date) {
  const d = new Date(date)
  const day = d.getDay()
  if (day === 6) d.setDate(d.getDate() + 2)
  if (day === 0) d.setDate(d.getDate() + 1)
  return d
}
