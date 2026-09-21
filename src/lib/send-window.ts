// Sending-window maths. Pure functions, safe in the browser and on the server.
// Times are expressed in the window's timezone (default: India, 21:00–24:00,
// which lands in US business hours and UK late afternoon).
import { DateTime } from 'luxon'

export interface SendWindow {
  timezone: string      // IANA, e.g. "Asia/Kolkata"
  start: string         // "HH:mm"
  end: string           // "HH:mm"; "24:00" = midnight
  skipWeekends: boolean // weekends judged in the window's timezone
}

export const DEFAULT_SEND_WINDOW: SendWindow = {
  timezone: 'Asia/Kolkata',
  start: '21:00',
  end: '24:00',
  skipWeekends: true,
}

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function isSendDay(dt: DateTime, w: SendWindow) {
  return !w.skipWeekends || dt.weekday <= 5 // 6 = Sat, 7 = Sun
}

/** [start, end) of the window on the calendar day of `day` (in window tz) */
function windowOn(day: DateTime, w: SendWindow) {
  const base = day.startOf('day')
  return { start: base.plus({ minutes: minutes(w.start) }), end: base.plus({ minutes: minutes(w.end) }) }
}

export function isInSendWindow(at: Date, w: SendWindow = DEFAULT_SEND_WINDOW) {
  const now = DateTime.fromJSDate(at).setZone(w.timezone)
  if (!isSendDay(now, w)) return false
  const { start, end } = windowOn(now, w)
  return now >= start && now < end
}

/**
 * First moment at or after `from` that is inside a send window, plus a random offset
 * so emails don't all leave at exactly 21:00 (spread = fraction of the window used).
 */
export function nextWindowSlot(from: Date, w: SendWindow = DEFAULT_SEND_WINDOW, spread = 0.8): Date {
  let day = DateTime.fromJSDate(from).setZone(w.timezone)
  for (let i = 0; i < 14; i++) {
    const { start, end } = windowOn(day, w)
    // Need 15+ minutes left so the 15-minute worker gets a chance to send it
    if (isSendDay(day, w) && day < end.minus({ minutes: 15 })) {
      const earliest = day > start ? day : start
      const room = end.minus({ minutes: 15 }).diff(earliest, 'minutes').minutes
      const offset = Math.floor(Math.random() * Math.max(1, room * spread))
      return earliest.plus({ minutes: offset }).toJSDate()
    }
    day = day.plus({ days: 1 }).startOf('day')
  }
  return from
}

/** Slot in the window `days` calendar days after `from` (e.g. follow-up 1 = 3 days after the first email) */
export function windowSlotAfterDays(from: Date, days: number, w: SendWindow = DEFAULT_SEND_WINDOW) {
  const target = DateTime.fromJSDate(from).setZone(w.timezone).plus({ days }).startOf('day')
  return nextWindowSlot(target.toJSDate(), w)
}

/** "Tonight 9:00–12:00 AM IST" style label for the next window */
export function describeWindow(w: SendWindow = DEFAULT_SEND_WINDOW) {
  const day = DateTime.now().setZone(w.timezone)
  const { start, end } = windowOn(day, w)
  const zone = start.toFormat('ZZZZ')
  return `${start.toFormat('h:mm a')}–${end.toFormat('h:mm a')} ${zone}`
}

/** Format a date in the window timezone for display */
export function fmtInZone(d: Date | string, w: SendWindow = DEFAULT_SEND_WINDOW, fmt = 'EEE d MMM, h:mm a') {
  const dt = typeof d === 'string' ? DateTime.fromISO(d) : DateTime.fromJSDate(d)
  return `${dt.setZone(w.timezone).toFormat(fmt)} ${dt.setZone(w.timezone).toFormat('ZZZZ')}`
}

/** The next window expressed in another timezone, e.g. "11:30 AM – 2:30 PM" for US Eastern */
export function windowInZone(w: SendWindow, tz: string) {
  const today = DateTime.now().setZone(w.timezone)
  const { start, end } = windowOn(today, w)
  return `${start.setZone(tz).toFormat('h:mm a')} – ${end.setZone(tz).toFormat('h:mm a')}`
}
