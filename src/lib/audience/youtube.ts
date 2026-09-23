// Thin YouTube Data API v3 client. Only public data, only through the official API.
// Quota: 10,000 units/day by default. search = 100 units; everything else here = 1 unit.
import prisma from '../prisma'

const API = 'https://www.googleapis.com/youtube/v3'
const QUOTA_KEY = 'youtube_quota'
export const DAILY_QUOTA = Number(process.env.YOUTUBE_DAILY_QUOTA || 10_000)

export class YouTubeError extends Error {
  constructor(message: string, public reason = '', public status = 0) {
    super(message)
  }
}

export function youtubeConfigured() {
  return !!process.env.YOUTUBE_API_KEY
}

// Quota resets at midnight Pacific time
function quotaDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
}

export async function quotaUsage() {
  const row = await prisma.setting.findUnique({ where: { key: QUOTA_KEY } })
  const saved = row ? (JSON.parse(row.value) as { day: string; used: number }) : null
  const used = saved?.day === quotaDay() ? saved.used : 0
  return { used, limit: DAILY_QUOTA, left: Math.max(0, DAILY_QUOTA - used) }
}

async function spend(units: number) {
  const day = quotaDay()
  const { used } = await quotaUsage()
  const value = JSON.stringify({ day, used: used + units })
  await prisma.setting.upsert({ where: { key: QUOTA_KEY }, create: { key: QUOTA_KEY, value }, update: { value } })
}

async function call<T>(path: string, params: Record<string, string | number | undefined>, cost: number): Promise<T> {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) throw new YouTubeError('Add YOUTUBE_API_KEY to the environment to use YouTube discovery', 'noKey')
  const { left } = await quotaUsage()
  if (left < cost) throw new YouTubeError(`YouTube quota for today is used up (${DAILY_QUOTA} units). It resets at midnight Pacific time.`, 'quotaExceeded')

  const qs = new URLSearchParams({ key })
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
  const res = await fetch(`${API}/${path}?${qs}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  await spend(cost)
  const data = await res.json().catch(() => ({})) as { error?: { message?: string; errors?: Array<{ reason?: string }> } } & T
  if (!res.ok) {
    const reason = data.error?.errors?.[0]?.reason || ''
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
      // Google says we're out even if our own counter disagrees: trust Google
      await prisma.setting.upsert({
        where: { key: QUOTA_KEY },
        create: { key: QUOTA_KEY, value: JSON.stringify({ day: quotaDay(), used: DAILY_QUOTA }) },
        update: { value: JSON.stringify({ day: quotaDay(), used: DAILY_QUOTA }) },
      })
    }
    throw new YouTubeError(data.error?.message?.replace(/<[^>]+>/g, '') || `YouTube API error ${res.status}`, reason, res.status)
  }
  return data
}

// ─── URL parsing ─────────────────────────────────────────────────────────────

export type ParsedYouTubeUrl =
  | { kind: 'video'; id: string }
  | { kind: 'channel'; id: string }
  | { kind: 'handle'; handle: string }
  | { kind: 'query'; q: string }

export function parseYouTubeInput(input: string): ParsedYouTubeUrl {
  const s = input.trim()
  const video = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/)
  if (video) return { kind: 'video', id: video[1] }
  const channel = s.match(/youtube\.com\/channel\/(UC[\w-]{22})/) || s.match(/^(UC[\w-]{22})$/)
  if (channel) return { kind: 'channel', id: channel[1] }
  const handle = s.match(/youtube\.com\/@([\w.-]+)/) || s.match(/^@([\w.-]+)$/)
  if (handle) return { kind: 'handle', handle: handle[1] }
  if (/^[\w-]{11}$/.test(s)) return { kind: 'video', id: s }
  const legacy = s.match(/youtube\.com\/(?:c|user)\/([\w.-]+)/)
  return { kind: 'query', q: legacy ? legacy[1] : s }
}

// ─── API types (only the fields we read) ─────────────────────────────────────

interface Thumbs { default?: { url: string }; medium?: { url: string }; high?: { url: string } }

export interface YtChannel {
  id: string
  snippet: { title: string; description: string; customUrl?: string; country?: string; thumbnails?: Thumbs; defaultLanguage?: string }
  statistics?: { subscriberCount?: string; videoCount?: string; viewCount?: string; hiddenSubscriberCount?: boolean }
  contentDetails?: { relatedPlaylists?: { uploads?: string } }
}

export interface YtVideo {
  id: string
  snippet: {
    title: string; description: string; channelId: string; channelTitle: string; publishedAt: string
    thumbnails?: Thumbs; defaultAudioLanguage?: string; defaultLanguage?: string; tags?: string[]
  }
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }
  contentDetails?: { duration?: string }
}

export interface YtComment {
  id: string
  snippet: {
    authorDisplayName: string
    authorProfileImageUrl?: string
    authorChannelUrl?: string
    authorChannelId?: { value: string }
    textDisplay?: string
    textOriginal?: string
    likeCount?: number
    publishedAt?: string
    parentId?: string
    videoId?: string
  }
}

export interface YtCommentThread {
  id: string
  snippet: { topLevelComment: YtComment; totalReplyCount?: number; channelId?: string }
  replies?: { comments: YtComment[] }
}

// ─── Calls ───────────────────────────────────────────────────────────────────

export async function searchVideos(opts: {
  q: string
  regionCode?: string
  publishedAfter?: string
  order?: 'relevance' | 'viewCount' | 'date'
  duration?: 'any' | 'medium' | 'long'
  maxResults?: number
}) {
  const data = await call<{ items: Array<{ id: { videoId: string } }> }>('search', {
    part: 'snippet',
    type: 'video',
    q: opts.q,
    maxResults: Math.min(50, opts.maxResults || 50),
    relevanceLanguage: 'en',
    regionCode: opts.regionCode,
    publishedAfter: opts.publishedAfter,
    order: opts.order || 'relevance',
    // Shorts draw drive-by comments; medium/long tutorials draw builders
    videoDuration: opts.duration && opts.duration !== 'any' ? opts.duration : undefined,
    safeSearch: 'moderate',
  }, 100)
  return getVideos(data.items.map((i) => i.id.videoId).filter(Boolean))
}

export async function searchChannels(q: string, regionCode?: string) {
  const data = await call<{ items: Array<{ id: { channelId: string } }> }>('search', {
    part: 'snippet', type: 'channel', q, maxResults: 25, relevanceLanguage: 'en', regionCode,
  }, 100)
  return getChannels(data.items.map((i) => i.id.channelId).filter(Boolean))
}

export async function getVideos(ids: string[]): Promise<YtVideo[]> {
  const out: YtVideo[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const data = await call<{ items: YtVideo[] }>('videos', {
      part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(','), maxResults: 50,
    }, 1)
    out.push(...data.items)
  }
  return out
}

export async function getChannels(ids: string[]): Promise<YtChannel[]> {
  const out: YtChannel[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const data = await call<{ items?: YtChannel[] }>('channels', {
      part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(','), maxResults: 50,
    }, 1)
    out.push(...(data.items || []))
  }
  return out
}

export async function getChannelByHandle(handle: string): Promise<YtChannel | null> {
  const data = await call<{ items?: YtChannel[] }>('channels', {
    part: 'snippet,statistics,contentDetails', forHandle: `@${handle.replace(/^@/, '')}`,
  }, 1)
  return data.items?.[0] || null
}

/** Latest uploads of a channel (1 unit per 50 videos, far cheaper than search) */
export async function latestUploadIds(uploadsPlaylist: string, max = 50) {
  const ids: string[] = []
  let pageToken: string | undefined
  while (ids.length < max) {
    const data = await call<{ items: Array<{ contentDetails: { videoId: string } }>; nextPageToken?: string }>('playlistItems', {
      part: 'contentDetails', playlistId: uploadsPlaylist, maxResults: 50, pageToken,
    }, 1)
    ids.push(...data.items.map((i) => i.contentDetails.videoId))
    if (!data.nextPageToken) break
    pageToken = data.nextPageToken
  }
  return ids.slice(0, max)
}

/** One page (≤100 threads, top-level + up to 5 replies each). Throws YouTubeError('commentsDisabled') */
export async function commentThreadsPage(videoId: string, pageToken?: string | null) {
  return call<{ items: YtCommentThread[]; nextPageToken?: string }>('commentThreads', {
    part: 'snippet,replies',
    videoId,
    maxResults: 100,
    // "relevance" puts the substantive, liked comments first: best prospects arrive earliest
    order: 'relevance',
    textFormat: 'plainText',
    pageToken: pageToken || undefined,
  }, 1)
}

export function isoDurationSeconds(iso?: string) {
  const m = (iso || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0)
}

export function bestThumb(t?: Thumbs) {
  return t?.medium?.url || t?.high?.url || t?.default?.url || null
}
