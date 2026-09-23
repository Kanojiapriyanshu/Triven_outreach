// Links to a source item on its platform. Browser-safe.

export const PLATFORM_LABEL: Record<string, string> = { YOUTUBE: 'YouTube', HN: 'Hacker News' }

/** External ids are stored as-is for YouTube and prefixed "hn:" for Hacker News */
const bare = (id: string) => id.replace(/^hn:/, '')

export function videoUrl(platform: string | null | undefined, externalId: string) {
  return platform === 'HN' ? `https://news.ycombinator.com/item?id=${bare(externalId)}` : `https://www.youtube.com/watch?v=${externalId}`
}

export function commentUrl(platform: string | null | undefined, videoExternalId: string, commentExternalId: string) {
  return platform === 'HN'
    ? `https://news.ycombinator.com/item?id=${bare(commentExternalId)}`
    : `https://www.youtube.com/watch?v=${videoExternalId}&lc=${commentExternalId}`
}

export function profileUrl(p: { platform?: string | null; youtubeChannelId: string; profileUrl?: string | null }) {
  if (p.profileUrl) return p.profileUrl
  return p.platform === 'HN'
    ? `https://news.ycombinator.com/user?id=${encodeURIComponent(bare(p.youtubeChannelId))}`
    : `https://www.youtube.com/channel/${p.youtubeChannelId}`
}
