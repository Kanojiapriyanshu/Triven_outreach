// Identity resolution: who is this commenter, where do they work, what's their site?
// Uses a web-search API (not scraping a search engine) and only accepts a result when the
// person's name or handle actually matches it. A site is accepted only if it mentions them.
import { fetchHtml, hostOf, htmlToText, SHARED_HOSTS } from './enrich'
import { cleanHandle } from './classify'

export interface SearchResult { url: string; title: string; snippet: string }

export function searchProvider(): 'BRAVE' | 'SERPER' | null {
  if (process.env.BRAVE_SEARCH_API_KEY) return 'BRAVE'
  if (process.env.SERPER_API_KEY) return 'SERPER'
  return null
}

export async function webSearch(q: string, country?: string | null): Promise<SearchResult[]> {
  const cc = country && /^[a-z]{2}$/i.test(country) ? country.toLowerCase() : ''
  const p = searchProvider()
  if (p === 'BRAVE') {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10${cc ? `&country=${cc === 'gb' ? 'gb' : cc}` : ''}`, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY! },
      signal: AbortSignal.timeout(10_000), cache: 'no-store',
    })
    if (!res.ok) throw new Error(`Brave search HTTP ${res.status}`)
    const d = await res.json() as { web?: { results?: Array<{ url: string; title: string; description?: string }> } }
    return (d.web?.results || []).map((r) => ({ url: r.url, title: strip(r.title), snippet: strip(r.description || '') }))
  }
  if (p === 'SERPER') {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SERPER_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, num: 10, ...(cc ? { gl: cc === 'gb' ? 'uk' : cc } : {}) }),
      signal: AbortSignal.timeout(10_000), cache: 'no-store',
    })
    if (!res.ok) throw new Error(`Serper HTTP ${res.status}`)
    const d = await res.json() as { organic?: Array<{ link: string; title: string; snippet?: string }> }
    return (d.organic || []).map((r) => ({ url: r.link, title: strip(r.title), snippet: strip(r.snippet || '') }))
  }
  return []
}

function strip(s: string) {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim()
}

const SOCIAL = /(^|\.)(youtube\.com|youtu\.be|facebook\.com|instagram\.com|tiktok\.com|reddit\.com|quora\.com|medium\.com|pinterest\.[a-z.]+|github\.com|wikipedia\.org|crunchbase\.com|zoominfo\.com|rocketreach\.co|apollo\.io|signalhire\.com|contactout\.com|lusha\.com|glassdoor\.[a-z.]+|indeed\.com|upwork\.com|fiverr\.com|amazon\.[a-z.]+|google\.com|bing\.com|threads\.net|skool\.com|linktr\.ee|x\.com|twitter\.com|linkedin\.com)$/i

export interface Identity {
  website?: string
  linkedIn?: string
  twitter?: string
  company?: string
  jobTitle?: string
  notes: string[]
  searches: number
}

const GENERIC_HANDLE = /^(user|channel|official|tech|ai|the|mr|real|its|im|hello|info)[-_.]?\w{0,6}$|^\w{0,3}$|\d{4,}/i

/** Search for the person; returns only matches we can tie to their name/handle */
export async function resolveIdentity(p: {
  displayName: string; firstName?: string | null; lastName?: string | null; handle?: string | null
  company?: string | null; topic?: string | null; interestCategory?: string | null; country?: string | null
}): Promise<Identity> {
  const out: Identity = { notes: [], searches: 0 }
  const first = p.firstName?.trim() || ''
  const last = p.lastName?.trim() || ''
  const fullName = first && last ? `${first} ${last}` : ''
  const handle = cleanHandle(p.handle || '').toLowerCase()
  const handleOk = handle.length >= 5 && /[a-z]/.test(handle) && !GENERIC_HANDLE.test(handle)
  if (!fullName && !handleOk) {
    out.notes.push('Identity search skipped: no real name or distinctive handle')
    return out
  }

  const context = p.company ? `"${p.company}"` : /agency|automation/i.test(p.topic || '') ? 'AI automation' : 'AI'
  const queries = [
    fullName ? `"${fullName}" ${context}` : '',
    handleOk ? `"${handle}"` : '',
    fullName && !p.company ? `"${fullName}" linkedin ${context}` : '',
  ].filter(Boolean).slice(0, 2)

  const lf = first.toLowerCase(), ll = last.toLowerCase()
  const nameIn = (s: string) => !!fullName && s.toLowerCase().includes(lf) && s.toLowerCase().includes(ll)
  const handleIn = (s: string) => handleOk && s.toLowerCase().replace(/[^a-z0-9]/g, '').includes(handle.replace(/[^a-z0-9]/g, ''))

  const candidates: Array<{ url: string; score: number }> = []
  for (const q of queries) {
    let results: SearchResult[]
    try {
      results = await webSearch(q, p.country)
      out.searches++
    } catch (err) {
      out.notes.push(`Search failed: ${(err as Error).message}`)
      break
    }
    for (const r of results) {
      const host = hostOf(r.url)
      const text = `${r.title} ${r.snippet}`
      if (/(^|\.)linkedin\.com$/.test(host) && /linkedin\.com\/in\//i.test(r.url)) {
        // "Jane Doe - Founder - Acme AI | LinkedIn"
        if (!out.linkedIn && (nameIn(r.title) || handleIn(r.url))) {
          out.linkedIn = r.url.split('?')[0]
          // Search engines cut long titles: drop the trailing "…" fragment rather than store half a word
          const parts = r.title.replace(/\s*\|\s*LinkedIn.*$/i, '').replace(/\s*(\.\.\.|…)\s*$/, '').replace(/\s*[|&,]\s*$/, '').split(/\s+[-–]\s+/)
          if (parts.length >= 3) { out.jobTitle ||= parts[1]; out.company ||= parts[2] }
          else if (parts.length === 2 && !/linkedin/i.test(parts[1])) out.jobTitle ||= parts[1]
        }
        continue
      }
      if (/(^|\.)(x|twitter)\.com$/.test(host)) {
        const u = r.url.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{2,15})(?:[/?]|$)/)?.[1]
        if (u && !out.twitter && (handleIn(u) || nameIn(r.title))) out.twitter = `https://x.com/${u}`
        continue
      }
      if (SOCIAL.test(host)) continue
      let score = 0
      if (nameIn(text)) score += 2
      if (handleIn(host) || handleIn(text)) score += 2
      if (fullName && (host.includes(ll) || host.includes(lf + ll))) score += 2
      if (p.company && host.replace(/[^a-z0-9]/g, '').includes(p.company.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12))) score += 3
      if (score >= 2) candidates.push({ url: `https://${host}`, score })
    }
  }

  // A website counts only if the page itself names them
  const tokens = [fullName && ll, handleOk && handle].filter(Boolean) as string[]
  for (const c of candidates.sort((a, b) => b.score - a.score).slice(0, 2)) {
    if (await confirmSite(c.url, tokens)) {
      out.website = c.url
      out.notes.push(`Website found by search and confirmed: ${hostOf(c.url)}`)
      break
    }
  }
  if (out.linkedIn) out.notes.push('LinkedIn profile found by search')
  if (!out.website && !out.linkedIn) out.notes.push(`Search found no profile that clearly matches (${out.searches} search${out.searches === 1 ? '' : 'es'})`)
  return out
}

export async function confirmSite(url: string, tokens: string[]) {
  if (!tokens.length || SHARED_HOSTS.test(hostOf(url)) && !tokens.some((t) => hostOf(url).includes(t))) return false
  const page = await fetchHtml(url, 7_000)
  if (!page) return false
  const text = htmlToText(page.html).toLowerCase()
  return tokens.some((t) => text.includes(t.toLowerCase()))
}
