import { z } from 'zod'
import prisma from './prisma'

export const TEMPLATE_TYPES = ['FIRST_EMAIL', 'FOLLOW_UP_1', 'FOLLOW_UP_2', 'FOLLOW_UP_3', 'OTHER'] as const

export const templateSchema = z.object({
  name: z.string().trim().min(1, 'Template name is required'),
  // Follow-ups reply in the original thread ("Re: …"), so their subject is optional
  subject: z.string().trim().default(''),
  body: z.string().trim().min(1, 'Template body is required'),
  type: z.enum(TEMPLATE_TYPES),
  campaignId: z.string().nullish(),
  isDefault: z.boolean().optional(),
}).refine(t => t.type.startsWith('FOLLOW_UP') || t.subject.length > 0, {
  message: 'Subject is required', path: ['subject'],
})

/** Only one default per type + campaign */
export async function clearOtherDefaults(type: string, campaignId: string | null | undefined, keepId: string) {
  await prisma.emailTemplate.updateMany({
    where: { type, campaignId: campaignId || null, isDefault: true, id: { not: keepId } },
    data: { isDefault: false },
  })
}
