/**
 * Flat-primitive query-key factory (connectPro convention) — keeps cache
 * invalidation predictable and typo-proof.
 */
export const HEDGES_QUERY_KEYS = {
  all: ['hedges'] as const,
  list: () => [...HEDGES_QUERY_KEYS.all, 'list'] as const,
  detail: (id: string) => [...HEDGES_QUERY_KEYS.all, 'detail', id] as const,
}
