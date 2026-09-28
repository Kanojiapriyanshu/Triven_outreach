// Who may change what (PRD R12.1). Enforced once, in the middleware, for every API write.
// Browser-safe (the middleware runs on the edge).
//   ADMIN    everything: keys, inboxes, settings, users, capability sheet, exclusions
//   OPERATOR runs prospecting and campaigns: Lead Finder, Audience, segments, campaigns, templates, imports
//   SALES    works conversations: inbox, leads, pipeline, sending single emails
//   VIEWER   read-only

export const ROLES = {
  ADMIN: { label: 'Admin', hint: 'Everything, including keys, inboxes, settings and users' },
  OPERATOR: { label: 'Operator', hint: 'Prospecting, audiences, campaigns, templates and imports' },
  SALES: { label: 'Sales', hint: 'Inbox, leads, pipeline and single emails' },
  VIEWER: { label: 'Viewer', hint: 'Read-only' },
} as const
export type Role = keyof typeof ROLES

const ADMIN_ONLY = [
  '/api/settings', '/api/sender-accounts', '/api/gmail', '/api/users', '/api/suppression', '/api/system',
  '/api/audience/capabilities', '/api/audience/exclusions', '/api/audience/settings', '/api/finder/settings',
]
const SALES_ALLOWED = [
  '/api/inbox', '/api/leads', '/api/email', '/api/followups', '/api/notifications', '/api/pipeline', '/api/auth', '/api/search',
]

/** null = allowed; otherwise the reason to show */
export function writeBlocked(role: string | undefined, path: string, method: string): string | null {
  if (method === 'GET' || method === 'HEAD' || path.startsWith('/api/auth/')) return null
  const r = (role || 'VIEWER').toUpperCase()
  if (r === 'ADMIN') return null
  if (ADMIN_ONLY.some((p) => path.startsWith(p))) return 'Only an admin can change this'
  if (r === 'OPERATOR') return null
  if (r === 'SALES' && SALES_ALLOWED.some((p) => path.startsWith(p))) return null
  return r === 'SALES' ? 'Your role (Sales) can work conversations, not change campaigns or prospecting' : 'Your role is read-only'
}
