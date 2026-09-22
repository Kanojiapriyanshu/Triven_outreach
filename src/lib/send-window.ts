// Sending-window maths. Pure functions, safe in the browser and on the server.
// Times are expressed in the window's timezone (default: India, 21:00–24:00,
// which lands in US business hours and UK late afternoon).
// A window may cross midnight (e.g. 21:00 → 02:00): it belongs to the day it starts on.
import { DateTime } from 'luxon'

export interface SendWindow {
  timezone: string      // IANA, e.g. "Asia/Kolkata"
  start: string         // "HH:mm"
  end: string           // "HH:mm"; "24:00" = midnight; earlier than start = next day
  skipWeekends: boolean // weekends judged in the window's timezone (used when `days` is not set)
  days?: number[]       // 1 = Monday … 7 = Sunday; overrides skipWeekends
}

export const DEFAULT_SEND_WINDOW: SendWindow = {
  timezone: 'Asia/Kolkata',
  start: '21:00',
  end: '24:00',
  skipWeekends: true,
}

export const WEEKDAYS = [1, 2, 3, 4, 5]
export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Window length in minutes (handles windows that run past midnight) */
export function windowMinutes(w: SendWindow) {
  const len = minutes(w.end) - minutes(w.start)
  return len > 0 ? len : len + 24 * 60
}

function isSendDay(dt: DateTime, w: SendWindow) {
  if (w.days?.length) return w.days.includes(dt.weekday)
  return !w.skipWeekends || dt.weekday <= 5 // 6 = Sat, 7 = Sun
}

/** [start, end) of the window that starts on the calendar day of `day` (in window tz) */
function windowOn(day: DateTime, w: SendWindow) {
  const start = day.startOf('day').plus({ minutes: minutes(w.start) })
  return { start, end: start.plus({ minutes: windowMinutes(w) }) }
}

export function isInSendWindow(at: Date, w: SendWindow = DEFAULT_SEND_WINDOW) {
  const now = DateTime.fromJSDate(at).setZone(w.timezone)
  // Today's window, or yesterday's if it runs past midnight
  for (const day of [now, now.minus({ days: 1 })]) {
    if (!isSendDay(day, w)) continue
    const { start, end } = windowOn(day, w)
    if (now >= start && now < end) return true
  }
  return false
}

/**
 * First moment at or after `from` that is inside a send window, plus a random offset
 * so emails don't all leave at exactly 21:00 (spread = fraction of the window used).
 */
export function nextWindowSlot(from: Date, w: SendWindow = DEFAULT_SEND_WINDOW, spread = 0.8): Date {
  const t = DateTime.fromJSDate(from).setZone(w.timezone)
  const margin = Math.min(15, Math.floor(windowMinutes(w) / 4))
  // Start from yesterday in case we're inside a window that began before midnight
  let day = t.minus({ days: 1 }).startOf('day')
  for (let i = 0; i < 16; i++) {
    const { start, end } = windowOn(day, w)
    const lastUseful = end.minus({ minutes: margin }) // leave the worker time to send it
    if (isSendDay(day, w) && t < lastUseful) {
      const earliest = t > start ? t : start
      const room = lastUseful.diff(earliest, 'minutes').minutes
      const offset = Math.floor(Math.random() * Math.max(1, room * spread))
      return earliest.plus({ minutes: offset }).toJSDate()
    }
    day = day.plus({ days: 1 })
  }
  return from
}

/** Slot in the window `days` calendar days after `from` (e.g. follow-up 1 = 3 days after the first email) */
export function windowSlotAfterDays(from: Date, days: number, w: SendWindow = DEFAULT_SEND_WINDOW) {
  const target = DateTime.fromJSDate(from).setZone(w.timezone).plus({ days }).startOf('day')
  return nextWindowSlot(target.toJSDate(), w)
}

/** The window that is open at `at`, or the next one: used to lay out bulk sends */
export function currentOrNextWindow(at: Date, w: SendWindow) {
  const t = DateTime.fromJSDate(at).setZone(w.timezone)
  let day = t.minus({ days: 1 }).startOf('day')
  for (let i = 0; i < 16; i++) {
    const { start, end } = windowOn(day, w)
    if (isSendDay(day, w) && t < end) return { start: (t > start ? t : start).toJSDate(), end: end.toJSDate() }
    day = day.plus({ days: 1 })
  }
  return null
}

/**
 * Evenly paced send times, Instantly-style: one email every `gapMin`–`gapMax` minutes
 * (random each time), only inside the window; overflow rolls to the next send day.
 */
export function staggeredSlots(
  count: number, from: Date, w: SendWindow, gapMin: number, gapMax: number,
  maxPerWindow = Infinity, random = Math.random,
) {
  const slots: Date[] = []
  let cursor = from
  let win = currentOrNextWindow(cursor, w)
  while (slots.length < count && win) {
    let t = Math.max(cursor.getTime(), win.start.getTime())
    let inThisWindow = 0
    while (slots.length < count && t < win.end.getTime() && inThisWindow < maxPerWindow) {
      inThisWindow++
      slots.push(new Date(t))
      const gap = gapMin + random() * Math.max(0, gapMax - gapMin)
      t += gap * 60_000
    }
    cursor = new Date(win.end.getTime() + 60_000)
    win = currentOrNextWindow(cursor, w)
  }
  return slots
}

/** "9:00 PM–12:00 AM IST" style label for the window */
export function describeWindow(w: SendWindow = DEFAULT_SEND_WINDOW) {
  const day = DateTime.now().setZone(w.timezone)
  const { start, end } = windowOn(day, w)
  const zone = start.toFormat('ZZZZ')
  return `${start.toFormat('h:mm a')}–${end.toFormat('h:mm a')} ${zone}`
}

/** "Mon–Fri", "Every day", "Mon, Wed, Fri" */
export function describeDays(w: SendWindow) {
  const days = w.days?.length ? [...w.days].sort() : w.skipWeekends ? WEEKDAYS : [1, 2, 3, 4, 5, 6, 7]
  if (days.length === 7) return 'Every day'
  if (days.join() === '1,2,3,4,5') return 'Mon–Fri'
  return days.map((d) => DAY_LABELS[d - 1]).join(', ')
}

/** Format a date in the window timezone for display */
export function fmtInZone(d: Date | string, w: SendWindow = DEFAULT_SEND_WINDOW, fmt = 'EEE d MMM, h:mm a') {
  const dt = typeof d === 'string' ? DateTime.fromISO(d) : DateTime.fromJSDate(d)
  return `${dt.setZone(w.timezone).toFormat(fmt)} ${dt.setZone(w.timezone).toFormat('ZZZZ')}`
}

/** The window expressed in another timezone, e.g. "11:30 AM – 2:30 PM" for US Eastern */
export function windowInZone(w: SendWindow, tz: string) {
  const today = DateTime.now().setZone(w.timezone)
  const { start, end } = windowOn(today, w)
  return `${start.setZone(tz).toFormat('h:mm a')} – ${end.setZone(tz).toFormat('h:mm a')}`
}
