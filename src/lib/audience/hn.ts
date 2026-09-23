// Hacker News through its public search API (Algolia, free, no key). Threads about AI agents
// and automation are full of developers and founders describing what they're building; their
// profile "about" is where they publish their own site or email.
const API = 'https://hn.algolia.com/api/v1'

export const HN_CHANNEL_ID = 'hn'
export const HN_CHANNEL_TITLE = 'Hacker News'

export interface HnStory {
  id: string; title: string; url: string | null; author: string; points: number; comments: number; createdAt: Date
}

export interface HnComment {
  id: string; author: string; text: string; parentId: string | null; storyId: string; createdAt: Date | null; points: number
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(20_000), cache: 'no-store' })
  if (!res.ok) throw new Error(`Hacker News API HTTP ${res.status}`)
  return res.json() as Promise<T>
}

/** HN text is HTML: <p>, <a href>, <i>, entities */
export function hnText(html?: string | null) {
  return (html || '')
    .replace(/<a\s+href="([^"]+)"[^>]*>[^<]*<\/a>/gi, ' $1 ')
    .replace(/<p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x2F;/g, '/').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/** Stories (incl. Show HN / Ask HN) matching a query, with enough discussion to be worth reading */
export async function searchStories(q: string, opts: { minComments?: number; sinceDays?: number; sort?: 'relevance' | 'date' } = {}): Promise<HnStory[]> {
  const filters = [`num_comments>=${opts.minComments ?? 20}`]
  if (opts.sinceDays) filters.push(`created_at_i>${Math.floor(Date.now() / 1000) - opts.sinceDays * 86400}`)
  const path = `/${opts.sort === 'date' ? 'search_by_date' : 'search'}?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=40&numericFilters=${encodeURIComponent(filters.join(','))}`
  const d = await get<{ hits: Array<{ objectID: string; title: string; url?: string | null; author: string; points?: number; num_comments?: number; created_at_i: number }> }>(path)
  return d.hits.map((h) => ({
    id: h.objectID, title: h.title, url: h.url || null, author: h.author,
    points: h.points || 0, comments: h.num_comments || 0, createdAt: new Date(h.created_at_i * 1000),
  }))
}

interface ItemNode {
  id: number; author: string | null; text: string | null; title?: string | null; parent_id: number | null; story_id: number
  created_at_i?: number; points?: number | null; type: string; children: ItemNode[]
}

/** The whole comment tree of a story in one call, flattened */
export async function storyComments(storyId: string): Promise<{ story: { title: string; author: string; text: string } | null; comments: HnComment[] }> {
  const root = await get<ItemNode>(`/items/${storyId}`)
  const out: HnComment[] = []
  const walk = (n: ItemNode) => {
    for (const c of n.children || []) {
      if (c.type === 'comment' && c.author && c.text) {
        out.push({
          id: String(c.id), author: c.author, text: hnText(c.text), parentId: c.parent_id === root.id ? null : String(c.parent_id),
          storyId, createdAt: c.created_at_i ? new Date(c.created_at_i * 1000) : null, points: c.points || 0,
        })
      }
      walk(c)
    }
  }
  walk(root)
  return { story: root.author ? { title: root.title || '', author: root.author, text: hnText(root.text) } : null, comments: out }
}

/** Public profile: the "about" text people write themselves (often a site, email or company) */
export async function hnUser(username: string): Promise<{ about: string; karma: number } | null> {
  try {
    const d = await get<{ about?: string | null; karma?: number }>(`/users/${encodeURIComponent(username)}`)
    return { about: hnText(d.about), karma: d.karma || 0 }
  } catch {
    return null
  }
}

export const hnStoryUrl = (id: string) => `https://news.ycombinator.com/item?id=${id}`
export const hnUserUrl = (username: string) => `https://news.ycombinator.com/user?id=${encodeURIComponent(username)}`
