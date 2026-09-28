// Source connectors (PRD M1). Every source produces the same shape — container → content →
// engagement → person — so the CRM never changes when a source is added. A new source is one
// file here plus its registration below. Browser-safe metadata only; server code lives with
// each connector's implementation (lib/audience/*, lib/finder/*).

export interface ConnectorInfo {
  id: 'YOUTUBE' | 'HN' | 'DEVTO' | 'COMMUNITY' | 'LEAD_FINDER'
  label: string
  kind: 'audience' | 'business'
  /** What one "container" and "content" are for this source */
  container: string
  content: string
  engagement: string
  cost: string
  needs: string | null
  /** Terms that shaped how it's used */
  rules: string
}

export const CONNECTORS: ConnectorInfo[] = [
  {
    id: 'YOUTUBE', label: 'YouTube', kind: 'audience', container: 'channel', content: 'video', engagement: 'comment or reply',
    cost: '10,000 API units / day (a search costs 100, comments ~1 per 100)', needs: 'YOUTUBE_API_KEY',
    rules: 'Official Data API only; one API project; data older than 30 days refreshed or deleted',
  },
  {
    id: 'HN', label: 'Hacker News', kind: 'audience', container: 'Hacker News', content: 'thread', engagement: 'comment',
    cost: 'Free (Algolia API)', needs: null, rules: 'Public API; only what people publish in their own profile is used to reach them',
  },
  {
    id: 'DEVTO', label: 'DEV', kind: 'audience', container: 'DEV Community', content: 'article', engagement: 'comment, or writing the article',
    cost: 'Free (Forem API)', needs: null, rules: 'Public read API; only the website on their own profile is researched',
  },
  {
    id: 'COMMUNITY', label: 'Community export', kind: 'audience', container: 'community', content: 'import batch', engagement: 'post',
    cost: 'Free', needs: null,
    rules: 'Only exports from communities you run or have written permission to use; emails only when members agreed to be contacted; never scraped',
  },
  {
    id: 'LEAD_FINDER', label: 'Lead Finder', kind: 'business', container: 'search', content: 'map listing', engagement: 'the listing itself',
    cost: 'Google Places free monthly allowance (capped), or OpenStreetMap free', needs: 'GOOGLE_PLACES_API_KEY (optional)',
    rules: 'Official Places API or OpenStreetMap; Google Maps pages are never scraped',
  },
]

export const connectorOf = (id?: string | null) => CONNECTORS.find((c) => c.id === id) || null
