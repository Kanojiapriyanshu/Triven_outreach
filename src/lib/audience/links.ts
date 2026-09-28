// Links to a source item on its platform. Browser-safe.

export const PLATFORM_LABEL: Record<string, string> = { YOUTUBE: 'YouTube', HN: 'Hacker News', DEVTO: 'DEV', COMMUNITY: 'Community' }

/** External ids are stored as-is for YouTube and prefixed "hn:" / "devto:" for the others */
const bare = (id: string) => id.replace(/^(hn|devto):/, '')

export function videoUrl(platform: string | null | undefined, externalId: string, url?: string | null) {
  if (platform === 'DEVTO') return url || `https://dev.to/api/articles/${bare(externalId)}`
  return platform === 'HN' ? `https://news.ycombinator.com/item?id=${bare(externalId)}` : `https://www.youtube.com/watch?v=${externalId}`
}

export function commentUrl(platform: string | null | undefined, videoExternalId: string, commentExternalId: string, videoPageUrl?: string | null) {
  if (platform === 'DEVTO') {
    const id = bare(commentExternalId).replace(/^\d+:op$/, '')
    return videoPageUrl ? `${videoPageUrl}${id ? `#comment-${id}` : ''}` : videoUrl(platform, videoExternalId)
  }
  return platform === 'HN'
    ? `https://news.ycombinator.com/item?id=${bare(commentExternalId)}`
    : `https://www.youtube.com/watch?v=${videoExternalId}&lc=${commentExternalId}`
}

export function profileUrl(p: { platform?: string | null; youtubeChannelId: string; profileUrl?: string | null }) {
  if (p.profileUrl) return p.profileUrl
  if (p.platform === 'DEVTO') return `https://dev.to/${encodeURIComponent(bare(p.youtubeChannelId))}`
  return p.platform === 'HN'
    ? `https://news.ycombinator.com/user?id=${encodeURIComponent(bare(p.youtubeChannelId))}`
    : `https://www.youtube.com/channel/${p.youtubeChannelId}`
}
