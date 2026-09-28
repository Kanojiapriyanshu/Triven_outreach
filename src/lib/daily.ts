// Jobs that run once a day, piggy-backing on a worker call (no separate schedule needed).
import prisma from './prisma'
import { pruneRuns } from './worker-log'
import { qualityPass } from './audience/pipeline'
import { snapshotSources } from './audience/sources'
import { runSegmentFeeds } from './audience/segments'
import { weeklyInsightsNotice } from './insights'

const KEY = 'daily_last_run'

export async function dailyJobsDue() {
  const row = await prisma.setting.findUnique({ where: { key: KEY } })
  return !row || Date.now() - Number(row.value) > 20 * 3_600_000
}

export async function runDailyJobs(deadline: number) {
  const value = String(Date.now())
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } })
  const out: Record<string, unknown> = {}
  const step = async (name: string, fn: () => Promise<unknown>) => {
    if (Date.now() > deadline - 3_000) { out[name] = 'skipped: no time'; return }
    try { out[name] = await fn() } catch (err) { out[name] = `error: ${(err as Error).message}` }
  }
  await step('pruneRuns', pruneRuns)
  await step('quality', qualityPass)
  await step('sources', snapshotSources)
  await step('segments', runSegmentFeeds)
  await step('insights', weeklyInsightsNotice)
  return out
}
