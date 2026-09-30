// Heartbeat for the background worker: every call is recorded, so System Health can show
// whether the scheduler really runs every 5 minutes (GitHub's cron often doesn't).
import type { Prisma } from '@prisma/client'
import prisma from './prisma'

export const EXPECTED_EVERY_MIN = 5
/** Sending must run often; the research pipelines are fine every ~15 min */
const EXPECTED_MIN: Record<string, number> = { tick: EXPECTED_EVERY_MIN, audience: 15, finder: 15 }

export async function logRun<T>(action: string, source: string | null, fn: () => Promise<T>): Promise<T> {
  const started = Date.now()
  try {
    const result = await fn()
    await prisma.workerRun.create({
      data: { action, source, durationMs: Date.now() - started, ok: true, summary: JSON.parse(JSON.stringify(result ?? null, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))) as Prisma.InputJsonValue },
    }).catch(() => null)
    return result
  } catch (err) {
    await prisma.workerRun.create({
      data: { action, source, durationMs: Date.now() - started, ok: false, error: (err as Error).stack?.slice(0, 4000) || String(err) },
    }).catch(() => null)
    throw err
  }
}

/** Minutes since the last run of an action (null = never) */
export async function minutesSinceLast(action: string) {
  const last = await prisma.workerRun.findFirst({ where: { action }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } })
  return last ? Math.round((Date.now() - last.startedAt.getTime()) / 60_000) : null
}

/** Runs per hour for the last 24 h, per action, plus uptime vs. the expected cadence */
export async function workerStats() {
  const since = new Date(Date.now() - 86_400_000)
  const runs = await prisma.workerRun.findMany({ where: { startedAt: { gte: since } }, select: { action: true, startedAt: true, ok: true, durationMs: true, source: true }, orderBy: { startedAt: 'asc' } })
  const actions = ['tick', 'audience', 'finder']
  const expected = (24 * 60) / EXPECTED_EVERY_MIN
  const hours = Array.from({ length: 24 }, (_, i) => {
    const start = since.getTime() + i * 3_600_000
    const inHour = runs.filter((r) => r.startedAt.getTime() >= start && r.startedAt.getTime() < start + 3_600_000)
    return { hour: new Date(start).toISOString(), tick: inHour.filter((r) => r.action === 'tick').length }
  })
  const perAction = await Promise.all(actions.map(async (a) => {
    const mine = runs.filter((r) => r.action === a)
    const last = await prisma.workerRun.findFirst({ where: { action: a }, orderBy: { startedAt: 'desc' } })
    return {
      action: a,
      runs24h: mine.length,
      uptime: Math.min(100, Math.round((100 * mine.length * EXPECTED_MIN[a]) / (24 * 60))),
      failures24h: mine.filter((r) => !r.ok).length,
      avgMs: mine.length ? Math.round(mine.reduce((n, r) => n + r.durationMs, 0) / mine.length) : 0,
      last: last && { at: last.startedAt, ok: last.ok, durationMs: last.durationMs, error: last.error?.split('\n')[0] || null, source: last.source, summary: last.summary },
    }
  }))
  return { expectedPerDay: expected, hours, actions: perAction }
}

/** Keep two weeks of heartbeats */
export async function pruneRuns() {
  await prisma.workerRun.deleteMany({ where: { startedAt: { lt: new Date(Date.now() - 14 * 86_400_000) } } })
}
