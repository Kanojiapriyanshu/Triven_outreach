// DEV (dev.to) through its public Forem API (free, no key for reads). Articles tagged
// #aiagents / #n8n / #automation are written by people building exactly what Triven AI
// Builder sells, and their commenters are trying to build it too. A profile's own "website"
// field is where the research step looks for a published contact; nothing else is used.
const API = 'https://dev.to/api'
const UA = 'TrivenBot/1.0 (public profile lookup)'

export const DEVTO_CHANNEL_ID = 'devto'
export const DEVTO_CHANNEL_TITLE = 'DEV Community'

export interface DevArticle {
  id: string; title: string; url: string; description: string; tags: string[]
  author: string; authorName: string; reactions: number; comments: number; publishedAt: Date
}

export interface DevComment {
  id: string; author: string; authorName: string; text: string; parentId: string | null; createdAt: Date | null; avatarUrl: string | null
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000), cache: 'no-store' })
  if (res.status === 429) throw new Error('DEV is rate-limiting; try again in a minute')
  if (!res.ok) throw new Error(`DEV API HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export function devText(html?: string | null) {
  return (html || '')
    .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>[^<]*<\/a>/gi, ' $1 ')
    .replace(/<\/?(p|br|li|div|h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Top articles for a tag over the last N days, with enough discussion to be worth reading */
export async function searchArticles(tag: string, opts: { days?: number; minComments?: number } = {}): Promise<DevArticle[]> {
  const t = tag.toLowerCase().replace(/^#/, '').replace(/[^a-z0-9]/g, '')
  if (!t) throw new Error('Type a tag, e.g. aiagents')
  const pages = await Promise.all([1, 2].map((page) =>
    get<Array<{ id: number; title: string; url: string; description?: string; tag_list?: string[] | string; comments_count?: number; public_reactions_count?: number; published_at?: string; user: { username: string; name?: string } }>>(
      `/articles?tag=${t}&top=${opts.days || 30}&per_page=30&page=${page}`).catch(() => [])))
  const seen = new Set<number>()
  return pages.flat().filter((a) => !seen.has(a.id) && seen.add(a.id)).map((a) => ({
    id: String(a.id), title: a.title, url: a.url, description: a.description || '',
    tags: Array.isArray(a.tag_list) ? a.tag_list : String(a.tag_list || '').split(/,\s*/).filter(Boolean),
    author: a.user.username, authorName: a.user.name || a.user.username,
    reactions: a.public_reactions_count || 0, comments: a.comments_count || 0,
    publishedAt: new Date(a.published_at || Date.now()),
  })).filter((a) => a.comments >= (opts.minComments ?? 3))
}

interface CommentNode {
  id_code: string; created_at?: string; body_html?: string
  user?: { username?: string; name?: string; profile_image_90?: string }
  children?: CommentNode[]
}

/** Whole comment tree of an article, flattened (one call) */
export async function articleComments(articleId: string): Promise<DevComment[]> {
  const roots = await get<CommentNode[]>(`/comments?a_id=${encodeURIComponent(articleId)}`)
  const out: DevComment[] = []
  const walk = (nodes: CommentNode[], parent: string | null) => {
    for (const n of nodes) {
      const text = devText(n.body_html)
      if (n.user?.username && text) {
        out.push({ id: n.id_code, author: n.user.username, authorName: n.user.name || n.user.username, text, parentId: parent, createdAt: n.created_at ? new Date(n.created_at) : null, avatarUrl: n.user.profile_image_90 || null })
      }
      walk(n.children || [], n.id_code)
    }
  }
  walk(roots, null)
  return out
}

/** Public profile: what people chose to publish about themselves */
export async function devUser(username: string): Promise<{ summary: string; website: string; location: string; twitter: string; github: string; name: string } | null> {
  try {
    const d = await get<{ name?: string; summary?: string | null; website_url?: string | null; location?: string | null; twitter_username?: string | null; github_username?: string | null }>(
      `/users/by_username?url=${encodeURIComponent(username)}`)
    return {
      name: d.name || '', summary: d.summary || '', website: d.website_url || '', location: d.location || '',
      twitter: d.twitter_username || '', github: d.github_username || '',
    }
  } catch {
    return null
  }
}

export const devUserUrl = (username: string) => `https://dev.to/${encodeURIComponent(username)}`
