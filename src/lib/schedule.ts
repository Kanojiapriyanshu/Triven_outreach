// A campaign's effective sending schedule: its own settings where set, else the global ones.
// Pure (no database), so the browser can show the same numbers the worker uses.
import { windowMinutes, type SendWindow } from './send-window'

export interface CampaignScheduleFields {
  windowStart?: string | null
  windowEnd?: string | null
  sendDays?: string | null
  gapMinMinutes?: number | null
  gapMaxMinutes?: number | null
}

export interface GlobalScheduleFields {
  sendWindow: SendWindow
  minGapMinutes: number
  maxGapMinutes: number
}

export interface EffectiveSchedule {
  window: SendWindow
  /** Gap between two emails of this campaign, across all its inboxes (null = no campaign pacing) */
  gap: { min: number; max: number } | null
}

export function parseDays(s?: string | null) {
  const days = (s || '').split(',').map((d) => Number(d.trim())).filter((d) => d >= 1 && d <= 7)
  return days.length ? [...new Set(days)].sort() : undefined
}

export function campaignSchedule(c: CampaignScheduleFields | null | undefined, g: GlobalScheduleFields): EffectiveSchedule {
  const window: SendWindow = {
    ...g.sendWindow,
    ...(c?.windowStart ? { start: c.windowStart } : {}),
    ...(c?.windowEnd ? { end: c.windowEnd } : {}),
    ...(parseDays(c?.sendDays) ? { days: parseDays(c?.sendDays) } : {}),
  }
  const gap = c?.gapMinMinutes
    ? { min: c.gapMinMinutes, max: Math.max(c.gapMinMinutes, c.gapMaxMinutes ?? c.gapMinMinutes) }
    : null
  return { window, gap }
}

/** Roughly how many emails fit in one window at this pace */
export function emailsPerWindow(s: EffectiveSchedule, inboxes: number, perInboxGap: { min: number; max: number }) {
  const mins = windowMinutes(s.window)
  const campaignRate = s.gap ? mins / ((s.gap.min + s.gap.max) / 2) : Infinity
  const inboxRate = inboxes * (mins / ((perInboxGap.min + perInboxGap.max) / 2))
  return Math.floor(Math.min(campaignRate, inboxRate))
}

/** Deterministic gap for the email that was just sent (so every worker run agrees) */
export function gapAfter(seed: string, min: number, max: number) {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const span = Math.max(0, max - min)
  return (min + (span ? (h % (span * 10 + 1)) / 10 : 0)) * 60_000
}
