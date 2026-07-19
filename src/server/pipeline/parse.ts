import type { HedgeSpec } from '@/shared/schemas'

/**
 * Stage 1 — free text → HedgeSpec (spec §6.1).
 * Small model, JSON-only, Zod safeParse with ONE retry feeding the validation
 * error back. Degraded mode: on model failure, callers fall back to keyword-only
 * over the raw user text.
 */
export async function parseRisk(_prompt: string): Promise<HedgeSpec> {
  throw new Error('parseRisk: not implemented (feature: parse)')
}
