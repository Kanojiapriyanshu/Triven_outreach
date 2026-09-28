// Daily spend caps for paid services (PRD R4.3). Each call site asks before spending and
// records what it used; when a cap is reached that step simply waits for tomorrow.
import prisma from './prisma'

import type { Service } from './budget-labels'
export { SERVICE_LABEL, type Service } from './budget-labels'

export const DEFAULT_CAPS: Record<Service, number> = { ai: 300, search: 80, verifier: 200, finder: 40 }

const CAPS_KEY = 'spend_caps'
const USAGE_KEY = 'spend_usage'
const today = () => new Date().toISOString().slice(0, 10)

export async function getCaps(): Promise<Record<Service, number>> {
  const row = await prisma.setting.findUnique({ where: { key: CAPS_KEY } })
  try { return { ...DEFAULT_CAPS, ...(row ? JSON.parse(row.value) : {}) } } catch { return DEFAULT_CAPS }
}

export async function saveCaps(c: Record<Service, number>) {
  const value = JSON.stringify(c)
  await prisma.setting.upsert({ where: { key: CAPS_KEY }, create: { key: CAPS_KEY, value }, update: { value } })
}

export async function usageToday(): Promise<Record<Service, number>> {
  const row = await prisma.setting.findUnique({ where: { key: USAGE_KEY } })
  const saved = row ? JSON.parse(row.value) as { day: string } & Partial<Record<Service, number>> : null
  const base = { ai: 0, search: 0, verifier: 0, finder: 0 }
  return saved?.day === today() ? { ...base, ...saved, day: undefined } as Record<Service, number> : base
}

/** How many more units this service may use today */
export async function budgetLeft(s: Service) {
  const [caps, used] = await Promise.all([getCaps(), usageToday()])
  return Math.max(0, caps[s] - (used[s] || 0))
}

export async function spend(s: Service, n = 1) {
  if (n <= 0) return
  const used = await usageToday()
  const value = JSON.stringify({ ...used, [s]: (used[s] || 0) + n, day: today() })
  await prisma.setting.upsert({ where: { key: USAGE_KEY }, create: { key: USAGE_KEY, value }, update: { value } })
}
