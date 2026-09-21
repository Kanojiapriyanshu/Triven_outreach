// App-wide settings stored in the `settings` key/value table.
import prisma from './prisma'
import { DEFAULT_SEND_WINDOW, type SendWindow } from './send-window'

export interface OutreachSettings {
  sendWindow: SendWindow
  followUpDays: [number, number, number]
  /** Max automatic sends per Gmail account per day (first emails + follow-ups) */
  dailyCapPerSender: number
  /** Random wait between two emails from the same inbox, in minutes (Instantly-style) */
  minGapMinutes: number
  maxGapMinutes: number
}

export const DEFAULT_SETTINGS: OutreachSettings = {
  sendWindow: DEFAULT_SEND_WINDOW,
  followUpDays: [3, 7, 14],
  dailyCapPerSender: 40,
  minGapMinutes: 8,
  maxGapMinutes: 15,
}

const KEY = 'outreach'

export async function getSettings(): Promise<OutreachSettings> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } })
  if (!row) return DEFAULT_SETTINGS
  try {
    const saved = JSON.parse(row.value) as Partial<OutreachSettings>
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      sendWindow: { ...DEFAULT_SETTINGS.sendWindow, ...saved.sendWindow },
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function saveSettings(settings: OutreachSettings) {
  const value = JSON.stringify(settings)
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } })
}
