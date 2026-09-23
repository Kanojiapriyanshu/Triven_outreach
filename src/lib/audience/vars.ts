// Template variables for leads that came from the YouTube audience. Browser-safe.
import { INTERESTS, type Interest } from './taxonomy'

export interface AudienceLeadFields {
  sourcePlatform?: string | null
  sourceChannel?: string | null
  sourceVideo?: string | null
  commentTopic?: string | null
  interestCategory?: string | null
  persona?: string | null
}

/** Text we didn't write goes into templates: strip anything the renderer treats as syntax */
function plain(s: string) {
  return s.replace(/[{}|]/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

function stripEmoji(s: string) {
  return s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/#\w+/g, '').replace(/\s{2,}/g, ' ').trim()
}

/** "How I Built an AI Receptionist (n8n + Vapi) | Full Tutorial 🔥" → "How I Built an AI Receptionist (n8n + Vapi)" */
export function shortVideoTitle(title?: string | null) {
  let t = stripEmoji(title || '')
  if (t.length > 70) {
    const first = t.split(/\s*\|\s*|\s[–—-]\s|:\s|!\s/)[0]
    t = first.length >= 15 ? first : t
  }
  t = plain(t)
  if (t.length > 80) t = `${t.slice(0, 77).replace(/\s+\S*$/, '')}...`
  // SHOUTING TITLES read badly inside a sentence
  if (t === t.toUpperCase() && /[A-Z]{4}/.test(t)) t = t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
  return t
}

export function audienceVars(lead: AudienceLeadFields, firstName: string): Record<string, string> {
  const channel = plain(stripEmoji(lead.sourceChannel || ''))
  const video = shortVideoTitle(lead.sourceVideo)
  const topic = plain(lead.commentTopic || '').replace(/[.]+$/, '')
  const interest = INTERESTS[(lead.interestCategory || 'GENERAL_AI') as Interest] || INTERESTS.GENERAL_AI

  // "I came across your comment on Liam's video "How I built…" about building voice agents."
  const where = lead.sourcePlatform === 'HN'
    ? (video ? `in the Hacker News thread "${video}"` : 'on Hacker News')
    : channel && video ? `on ${channel}'s video "${video}"` : video ? `on "${video}"` : channel ? `on one of ${channel}'s videos` : ''
  const commentHook = where
    ? `{I came across|I saw|I was reading} your comment ${where}${topic ? ` about ${topic}` : ''}.`
    : topic ? `{I came across|I saw} a comment of yours about ${topic}.` : ''

  return {
    sourceChannel: channel,
    sourceVideo: video,
    commentTopic: topic,
    commentHook,
    useCase: interest.useCase,
    useCaseShort: interest.short,
    useCaseExamples: interest.examples,
  }
}
