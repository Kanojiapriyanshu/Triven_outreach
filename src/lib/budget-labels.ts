// Paid services with a daily cap (see budget.ts). Browser-safe.
export type Service = 'ai' | 'search' | 'verifier' | 'finder'

export const SERVICE_LABEL: Record<Service, { label: string; unit: string }> = {
  ai: { label: 'AI review', unit: 'people' },
  search: { label: 'Web search', unit: 'searches' },
  verifier: { label: 'Email verifier', unit: 'checks' },
  finder: { label: 'Email finders (Apollo / Hunter lookups)', unit: 'lookups' },
}
