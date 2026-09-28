import prisma from '../prisma'

export interface FinderSettings {
  /** Google Places calls allowed per month. Google's free cap for these fields is 1,000; stay under it */
  googleMonthlyCap: number
  /** Which addresses count as ready: only mailbox-verified, or also ones the business published itself */
  sendPolicy: 'VERIFIED_ONLY' | 'VERIFIED_OR_PUBLISHED'
  /** Drop franchises / chains (a local manager can't buy) */
  excludeChains: boolean
  /** Ignore businesses with fewer reviews than this (0 = keep all) */
  minReviews: number
  /** Ignore businesses rated below this (0 = keep all) */
  minRating: number
  /** Let the 5-minute worker research new businesses on its own */
  autoResearch: boolean
  /** Use the web-search API (Serper / Brave) to look for published emails and the owner's LinkedIn */
  useWebSearch: boolean
  /** Ask Hunter when the website has no address (free count check first; keeps the Audience credit reserve) */
  useHunter: boolean
  /** Guess owner / role addresses (info@, office@…) — only ever kept if a verifier confirms them */
  guessEmails: boolean
}

export const DEFAULT_FINDER_SETTINGS: FinderSettings = {
  googleMonthlyCap: 900,
  sendPolicy: 'VERIFIED_OR_PUBLISHED',
  excludeChains: true,
  minReviews: 0,
  minRating: 0,
  autoResearch: true,
  useWebSearch: true,
  useHunter: true,
  guessEmails: true,
}

const KEY = 'finder'

export async function getFinderSettings(): Promise<FinderSettings> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } })
  if (!row) return DEFAULT_FINDER_SETTINGS
  try {
    return { ...DEFAULT_FINDER_SETTINGS, ...(JSON.parse(row.value) as Partial<FinderSettings>) }
  } catch {
    return DEFAULT_FINDER_SETTINGS
  }
}

export async function saveFinderSettings(s: FinderSettings) {
  const value = JSON.stringify(s)
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } })
}
