// Contact discovery from public sources the person published themselves: their YouTube
// channel bio, their comment, their own website, their link-in-bio page and their public
// GitHub profile. No logins, no private data, robots.txt respected.
import { isUsableEmail, normalizeEmail } from './verify'
import { profileHints } from './classify'
import { countryFromDomain } from './taxonomy'

export type EmailSource = 'CHANNEL' | 'COMMENT' | 'WEBSITE' | 'GITHUB' | 'LINK_PAGE' | 'PATTERN' | 'MANUAL'

export interface Findings {
  emails: Array<{ email: string; source: EmailSource; sourceUrl?: string }>
  website?: string
  linkedIn?: string
  twitter?: string
  github?: string
  otherLinks: string[]
  company?: string
  jobTitle?: string
  fullName?: string
  location?: string
  bio?: string
  country?: string
  notes: string[]
}

const UA = 'Mozilla/5.0 (compatible; TrivenResearch/1.0; public contact lookup)'
const LINK_PAGES = /(^|\.)(linktr\.ee|beacons\.ai|bio\.link|linkin\.bio|lnk\.bio|campsite\.bio|hoo\.be|taplink\.cc|stan\.store|solo\.to|carrd\.co|withkoji\.com|bento\.me|msha\.ke|tap\.bio|flow\.page|link\.me)$/i
const NEVER_CRAWL = /(^|\.)(youtube\.com|youtu\.be|instagram\.com|facebook\.com|fb\.com|tiktok\.com|x\.com|twitter\.com|linkedin\.com|github\.com|discord\.gg|discord\.com|t\.me|telegram\.me|patreon\.com|calendly\.com|cal\.com|skool\.com|whop\.com|amazon\.[a-z.]+|amzn\.to|bit\.ly|tinyurl\.com|geni\.us|gumroad\.com|spotify\.com|apple\.com|podcasts\.apple\.com|twitch\.tv|reddit\.com|medium\.com|threads\.net|wa\.me|whatsapp\.com|pinterest\.[a-z.]+|snapchat\.com|kick\.com|rumble\.com|udemy\.com|google\.com|goo\.gl|forms\.gle|docs\.google\.com|drive\.google\.com|play\.google\.com|apps\.apple\.com|chat\.whatsapp\.com|paypal\.me|buymeacoffee\.com|ko-fi\.com|shopify\.com|etsy\.com|notion\.so)$/i
// Hosts where the site is theirs but the domain is not (no pattern guessing there)
export const SHARED_HOSTS = /(^|\.)(github\.io|vercel\.app|netlify\.app|wordpress\.com|blogspot\.com|wixsite\.com|carrd\.co|notion\.site|substack\.com|webflow\.io|framer\.(website|ai)|squarespace\.com|weebly\.com|super\.site|pages\.dev|herokuapp\.com|glitch\.me|replit\.app|mystrikingly\.com|godaddysites\.com|site123\.me|beehiiv\.com|ghost\.io)$/i

export function hostOf(url: string) {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

// ─── Text extraction ─────────────────────────────────────────────────────────

/** Emails incl. the usual obfuscations: "name [at] site [dot] com", "name(at)site.com" */
export function extractEmails(text: string) {
  const t = text
    .replace(/\s*[[({<]\s*at\s*[\])}>]\s*/gi, '@')
    .replace(/\s*[[({<]\s*dot\s*[\])}>]\s*/gi, '.')
    .replace(/(\w)\s+@\s+(\w)/g, '$1@$2')
  const found = t.match(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi) || []
  return [...new Set(found.map(normalizeEmail))].filter(isUsableEmail)
}

const TLDS = 'com|io|ai|co|net|org|dev|app|agency|tech|studio|digital|solutions|consulting|xyz|me|so|biz|us|uk|ca|au|in|sg|nz|ie|za|ae|de|nl|co\\.uk|com\\.au|co\\.nz|co\\.za|co\\.in'

export function extractUrls(text: string) {
  const urls = new Set<string>()
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'`)\]]+/gi)) urls.add(m[0].replace(/[.,;:!?]+$/, ''))
  // bare domains ("acme-ai.com", "www.acme.io/contact") that aren't part of an email
  const bare = new RegExp(`(?<![@\\w./-])((?:www\\.)?[a-z0-9][a-z0-9-]{1,62}\\.(?:${TLDS})(?:/[^\\s<>"')\\]]*)?)(?![\\w@-])`, 'gi')
  for (const m of text.matchAll(bare)) {
    if (/\.(js|css|png|jpg)$/i.test(m[1])) continue
    urls.add(`https://${m[1].replace(/[.,;:!?]+$/, '')}`)
  }
  return [...urls]
}

function classifyLinks(urls: string[], f: Findings) {
  for (const raw of urls) {
    const host = hostOf(raw)
    if (!host) continue
    const url = raw.replace(/\/+$/, '')
    if (/(^|\.)linkedin\.com$/.test(host)) {
      if (/linkedin\.com\/(in|company)\//i.test(url)) f.linkedIn ||= url.split('?')[0]
    } else if (/(^|\.)(x|twitter)\.com$/.test(host)) {
      const u = url.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{2,15})(?:[/?]|$)/)?.[1]
      if (u && !/^(intent|share|home|search|hashtag|i)$/i.test(u)) f.twitter ||= `https://x.com/${u}`
    } else if (host === 'github.com') {
      const u = url.match(/github\.com\/([A-Za-z0-9-]{1,39})(?:[/?#]|$)/)?.[1]
      if (u && !/^(orgs|sponsors|features|about|topics|marketplace|login|join)$/i.test(u)) f.github ||= u
    } else if (LINK_PAGES.test(host) || NEVER_CRAWL.test(host)) {
      if (!f.otherLinks.includes(url)) f.otherLinks.push(url)
    } else {
      f.website ||= `https://${host}`
      if (`https://${host}` !== f.website && !f.otherLinks.includes(url)) f.otherLinks.push(url)
    }
  }
}

// ─── Fetching ────────────────────────────────────────────────────────────────

const robotsCache = new Map<string, string[]>()

async function allowedByRobots(url: URL) {
  const origin = url.origin
  if (!robotsCache.has(origin)) {
    let rules: string[] = []
    try {
      const res = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5_000), redirect: 'follow' })
      if (res.ok) {
        const lines = (await res.text()).split(/\r?\n/)
        let applies = false
        for (const line of lines) {
          const [k, ...rest] = line.split(':')
          const v = rest.join(':').trim()
          if (/^user-agent$/i.test(k.trim())) applies = v === '*' || /triven/i.test(v)
          else if (applies && /^disallow$/i.test(k.trim()) && v) rules.push(v)
        }
      }
    } catch { rules = [] }
    robotsCache.set(origin, rules)
  }
  return !robotsCache.get(origin)!.some((rule) => url.pathname.startsWith(rule.replace(/\*.*$/, '')))
}

export async function fetchHtml(rawUrl: string, timeoutMs = 8_000): Promise<{ url: string; html: string } | null> {
  let url: URL
  try { url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`) } catch { return null }
  if (!(await allowedByRobots(url))) return null
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
      cache: 'no-store',
    })
    if (!res.ok || !/text\/html|xhtml/i.test(res.headers.get('content-type') || '')) return null
    const html = (await res.text()).slice(0, 1_500_000)
    return { url: res.url || url.toString(), html }
  } catch {
    return null
  }
}

/** Cloudflare "email protection" hides addresses as hex XOR-encoded strings */
function decodeCfEmail(hex: string) {
  const key = parseInt(hex.slice(0, 2), 16)
  let out = ''
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key)
  return out
}

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#64;|&#x40;/gi, '@').replace(/&#46;|&#x2e;/gi, '.')
    .replace(/\s+/g, ' ')
}

interface PageFacts { emails: string[]; links: string[]; company?: string; person?: { name?: string; jobTitle?: string; email?: string } }

export function parsePage(html: string, baseUrl: string): PageFacts {
  const emails = new Set<string>()
  const links = new Set<string>()
  for (const m of html.matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)) emails.add(normalizeEmail(decodeURIComponent(m[1])))
  for (const m of html.matchAll(/data-cfemail\s*=\s*["']([0-9a-f]+)["']/gi)) emails.add(normalizeEmail(decodeCfEmail(m[1])))
  for (const e of extractEmails(htmlToText(html))) emails.add(e)
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try { links.add(new URL(m[1], baseUrl).toString()) } catch { /* ignore */ }
  }

  let company: string | undefined
  let person: PageFacts['person']
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim())
      const nodes: Array<Record<string, unknown>> = (Array.isArray(data) ? data : data['@graph'] || [data]).flat()
      for (const n of nodes) {
        const type = String(n['@type'] || '')
        if (typeof n.email === 'string') emails.add(normalizeEmail(n.email))
        if (/Organization|LocalBusiness|Corporation/i.test(type) && typeof n.name === 'string') company ||= n.name
        if (/Person/i.test(type)) {
          person = {
            name: typeof n.name === 'string' ? n.name : undefined,
            jobTitle: typeof n.jobTitle === 'string' ? n.jobTitle : undefined,
            email: typeof n.email === 'string' ? n.email : undefined,
          }
          const works = n.worksFor as { name?: string } | undefined
          if (works?.name) company ||= works.name
        }
      }
    } catch { /* malformed JSON-LD is common */ }
  }
  company ||= html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{2,60})["']/i)?.[1]
  return { emails: [...emails].filter(isUsableEmail), links: [...links], company: company?.trim(), person }
}

/** Homepage + up to 3 contact/about pages of the same site */
export async function crawlWebsite(site: string, f: Findings) {
  const home = await fetchHtml(site)
  if (!home) {
    f.notes.push(`${hostOf(site)}: site not reachable or blocks bots`)
    return
  }
  const host = hostOf(home.url)
  const pages = [home]
  const first = parsePage(home.html, home.url)
  const next = first.links
    .filter((l) => hostOf(l) === host && /contact|about|team|impressum|get-in-touch|work-with|hire|connect/i.test(new URL(l).pathname))
    .filter((l, i, a) => a.indexOf(l) === i)
    .slice(0, 3)
  for (const l of next) {
    const p = await fetchHtml(l, 6_000)
    if (p) pages.push(p)
  }
  let found = 0
  for (const p of pages) {
    const facts = p === home ? first : parsePage(p.html, p.url)
    for (const email of facts.emails) {
      const d = email.split('@')[1]
      // Keep their own-domain addresses, plus a free-mail address they chose to publish
      if (d === host || d.endsWith(`.${host}`) || host.endsWith(`.${d}`) || /gmail|outlook|hotmail|yahoo|icloud|proton/.test(d)) {
        f.emails.push({ email, source: 'WEBSITE', sourceUrl: p.url })
        found++
      }
    }
    classifyLinks(facts.links.filter((l) => /linkedin\.com\/in\/|linkedin\.com\/company\/|(?:x|twitter)\.com\/|github\.com\//i.test(l)), f)
    if (facts.company && !f.company && facts.company.length <= 60) f.company = facts.company
    if (facts.person?.jobTitle && !f.jobTitle) f.jobTitle = facts.person.jobTitle
  }
  f.notes.push(`${host}: ${pages.length} page${pages.length === 1 ? '' : 's'} read, ${found} address${found === 1 ? '' : 'es'}`)
}

/** Linktree & co.: pull out the links and any published email */
export async function readLinkPage(url: string, f: Findings) {
  const page = await fetchHtml(url)
  if (!page) return
  const facts = parsePage(page.html, page.url)
  for (const email of facts.emails) f.emails.push({ email, source: 'LINK_PAGE', sourceUrl: page.url })
  classifyLinks(facts.links.filter((l) => !LINK_PAGES.test(hostOf(l))), f)
  f.notes.push(`${hostOf(url)}: ${facts.emails.length} address${facts.emails.length === 1 ? '' : 'es'}`)
}

/** Public GitHub profile (developers often list email, company and site) */
export async function readGitHub(username: string, f: Findings) {
  const headers: Record<string, string> = { 'User-Agent': 'triven-crm', Accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  try {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, { headers, signal: AbortSignal.timeout(8_000), cache: 'no-store' })
    if (!res.ok) {
      f.notes.push(`GitHub ${username}: ${res.status === 403 ? 'rate limited (add GITHUB_TOKEN)' : `HTTP ${res.status}`}`)
      return
    }
    const u = await res.json() as { name?: string; company?: string; blog?: string; location?: string; email?: string; bio?: string; twitter_username?: string }
    if (u.email && isUsableEmail(normalizeEmail(u.email))) f.emails.push({ email: normalizeEmail(u.email), source: 'GITHUB', sourceUrl: `https://github.com/${username}` })
    if (u.name) f.fullName ||= u.name
    if (u.company) f.company ||= u.company.replace(/^@/, '').trim()
    if (u.location) f.location ||= u.location
    if (u.bio) f.bio ||= u.bio
    if (u.twitter_username) f.twitter ||= `https://x.com/${u.twitter_username}`
    if (u.blog) classifyLinks([u.blog.startsWith('http') ? u.blog : `https://${u.blog}`], f)
    f.notes.push(`GitHub ${username}: profile read${u.email ? ', public email' : ''}`)
  } catch {
    f.notes.push(`GitHub ${username}: not reachable`)
  }
}

/** Likely addresses for a person at their own domain; only worth anything once verified */
export function patternGuesses(firstName: string, lastName: string | undefined, domain: string) {
  const f = firstName.toLowerCase().replace(/[^a-z]/g, '')
  const l = (lastName || '').toLowerCase().replace(/[^a-z]/g, '')
  if (!f || !domain) return []
  const out = [`${f}@${domain}`]
  if (l) out.push(`${f}.${l}@${domain}`, `${f}${l}@${domain}`, `${f[0]}${l}@${domain}`)
  return out
}

/** Everything we can learn from text the person wrote (bio + comments), plus their links */
export async function discover(opts: { bio: string; comments: string[]; deadline: number }): Promise<Findings> {
  const f: Findings = { emails: [], otherLinks: [], notes: [] }
  const hints = profileHints(opts.bio)
  if (hints.jobTitle) f.jobTitle = hints.jobTitle
  if (hints.company) f.company = hints.company
  for (const email of extractEmails(opts.bio)) f.emails.push({ email, source: 'CHANNEL' })
  for (const c of opts.comments) for (const email of extractEmails(c)) f.emails.push({ email, source: 'COMMENT' })
  classifyLinks([...extractUrls(opts.bio), ...opts.comments.flatMap(extractUrls)], f)

  const timeLeft = () => opts.deadline - Date.now()
  for (const lp of f.otherLinks.filter((l) => LINK_PAGES.test(hostOf(l))).slice(0, 2)) {
    if (timeLeft() < 10_000) break
    await readLinkPage(lp, f)
  }
  if (f.github && timeLeft() > 8_000) await readGitHub(f.github, f)
  if (f.website && timeLeft() > 12_000) await crawlWebsite(f.website, f)
  f.country = countryFromDomain(f.website) || undefined

  // De-duplicate, first source wins
  const seen = new Set<string>()
  f.emails = f.emails.filter((e) => !seen.has(e.email) && seen.add(e.email))
  return f
}
