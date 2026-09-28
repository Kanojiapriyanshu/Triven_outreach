// The Triven capability sheet (Settings → Triven capabilities): what generated text may claim.
import prisma from '../prisma'
import { DEFAULT_CAPABILITIES, type CapabilitySheet } from './usecases'

const CAP_KEY = 'triven_capabilities'

export async function getCapabilities(): Promise<CapabilitySheet> {
  const row = await prisma.setting.findUnique({ where: { key: CAP_KEY } })
  if (!row) return DEFAULT_CAPABILITIES
  try { return { ...DEFAULT_CAPABILITIES, ...(JSON.parse(row.value) as Partial<CapabilitySheet>) } } catch { return DEFAULT_CAPABILITIES }
}

export async function saveCapabilities(c: CapabilitySheet) {
  const value = JSON.stringify(c)
  await prisma.setting.upsert({ where: { key: CAP_KEY }, create: { key: CAP_KEY, value }, update: { value } })
}
