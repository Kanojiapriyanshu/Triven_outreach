import prisma from '../prisma'

export interface AudienceSettings {
  /** Which addresses may enter the outreach-ready database */
  sendPolicy: 'VERIFIED_ONLY' | 'VERIFIED_OR_PUBLISHED'
  /** EU/UK/CA/AU/NZ: only addresses the person published themselves (no guessed patterns) */
  strictRegions: boolean
  /** Only prospects from these countries when the country is known ([] = any English speaker) */
  countries: string[]
  /** Lowest relevance that gets researched (enrichment costs time and verifier credits) */
  enrichFrom: 'HIGH' | 'MEDIUM'
  /** Comments to read per video (100 per YouTube API unit) */
  maxCommentsPerVideo: number
  /** Let the 5-minute worker run the pipeline on its own */
  autoRun: boolean
  /** Use the AI review when ANTHROPIC_API_KEY is set */
  useAi: boolean
  /** Delete non-relevant comments/profiles after this many days */
  retentionDays: number
  /** Free-mail (gmail…) only when the person published it as a contact AND intent is high */
  businessEmailsOnly: boolean
  /** Lowest relevance that may be emailed */
  outreachFrom: 'HIGH' | 'MEDIUM'
  /** Minimum identity score (0-100) before someone may be emailed */
  minIdentity: number
  /** Look people up with the web-search API when YouTube gives no site */
  useWebSearch: boolean
  /** Ask email-finder APIs (Hunter / Apollo) once identity is known */
  useFinders: boolean
  /** Hunter credits to always leave untouched (for your own manual lookups) */
  hunterReserve: number
  /** With no verifier key: use Hunter credits to verify only the emails that would make someone ready */
  hunterSmartVerify: boolean
}

export const DEFAULT_AUDIENCE_SETTINGS: AudienceSettings = {
  sendPolicy: 'VERIFIED_ONLY',
  strictRegions: true,
  countries: [],
  enrichFrom: 'MEDIUM',
  maxCommentsPerVideo: 2000,
  autoRun: true,
  useAi: true,
  retentionDays: 30,
  businessEmailsOnly: true,
  outreachFrom: 'HIGH',
  minIdentity: 40,
  useWebSearch: true,
  useFinders: true,
  hunterReserve: 5,
  hunterSmartVerify: true,
}

const KEY = 'audience'

export async function getAudienceSettings(): Promise<AudienceSettings> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } })
  if (!row) return DEFAULT_AUDIENCE_SETTINGS
  try {
    return { ...DEFAULT_AUDIENCE_SETTINGS, ...(JSON.parse(row.value) as Partial<AudienceSettings>) }
  } catch {
    return DEFAULT_AUDIENCE_SETTINGS
  }
}

export async function saveAudienceSettings(s: AudienceSettings) {
  const value = JSON.stringify(s)
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } })
}
