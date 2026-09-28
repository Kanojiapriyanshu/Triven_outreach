import type { Prisma } from '@prisma/client'

/** List filters from a query string (shared by the list, bulk actions and export) */
export function businessWhere(sp: URLSearchParams): Prisma.BusinessWhereInput {
  const where: Prisma.BusinessWhereInput = {}
  const status = sp.get('status')
  if (status === 'CALL') {
    // The call list: researched, no usable email, but a phone number
    where.status = { in: ['NO_EMAIL', 'EMAIL_FOUND'] }
    where.phone = { not: null }
  } else if (status && status !== 'ALL') where.status = { in: status.split(',') }
  else where.status = { notIn: ['EXCLUDED', 'DO_NOT_CONTACT'] }
  const tier = sp.get('tier')
  if (tier) where.tier = { in: tier.split(',') }
  const niche = sp.get('niche')
  if (niche) where.niche = niche
  const search = sp.get('search')
  if (search) where.searchId = search
  const q = sp.get('q')?.trim()
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { domain: { contains: q, mode: 'insensitive' } },
      { city: { contains: q, mode: 'insensitive' } },
      { ownerName: { contains: q, mode: 'insensitive' } },
      { emails: { some: { email: { contains: q, mode: 'insensitive' } } } },
    ]
  }
  return where
}

export function businessOrder(sort?: string | null): Prisma.BusinessOrderByWithRelationInput[] {
  if (sort === 'reviews') return [{ reviewCount: 'desc' }]
  if (sort === 'rating') return [{ rating: { sort: 'desc', nulls: 'last' } }, { reviewCount: 'desc' }]
  if (sort === 'newest') return [{ createdAt: 'desc' }]
  if (sort === 'name') return [{ name: 'asc' }]
  return [{ fitScore: 'desc' }, { reviewCount: 'desc' }]
}
