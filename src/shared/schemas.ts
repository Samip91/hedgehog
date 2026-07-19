import { z } from 'zod'

/**
 * Shared Zod schemas: the LLM `HedgeSpec` contract and the API envelope.
 * These are the single source of truth for both runtime validation and types.
 */

// ── HedgeSpec (Stage 1 parse output) — spec §6.1 ────────────────────────────
export const HedgeSpecSchema = z.object({
  /** Normalized restatement of the risk (this is what gets embedded). */
  riskDescription: z.string().min(1),
  domain: z.enum([
    'weather',
    'crypto',
    'politics',
    'sports',
    'economics',
    'other',
  ]),
  /** Which outcome HURTS the user. */
  direction: z.enum(['happens', 'does_not_happen']),
  exposureUsd: z.number().positive().nullable(),
  /** ISO date (YYYY-MM-DD) or null. */
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
    .nullable(),
  location: z.string().nullable(),
  asset: z.string().nullable(),
  threshold: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  clarificationNeeded: z.string().nullable(),
})

export type HedgeSpec = z.infer<typeof HedgeSpecSchema>

// ── API request contracts ───────────────────────────────────────────────────
export const HedgeRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
})
export type HedgeRequest = z.infer<typeof HedgeRequestSchema>

export const SaveHedgeRequestSchema = z.object({
  /** Client-generated UUID → idempotent upsert (spec §4). */
  id: z.string().uuid(),
  prompt: z.string().min(1),
  spec: HedgeSpecSchema,
  provider: z.enum(['KALSHI', 'POLYMARKET']),
  externalId: z.string().min(1),
  question: z.string().min(1),
  side: z.enum(['YES', 'NO']),
  entryPrice: z.number().min(0).max(1),
  stakeUsd: z.number().positive(),
})
export type SaveHedgeRequest = z.infer<typeof SaveHedgeRequestSchema>

// ── API response envelope — spec §8 ─────────────────────────────────────────
export type ApiError = { readonly code: string; readonly message: string }
export type ApiResponse<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ApiError }

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data }
}

export function err(code: string, message: string): {
  ok: false
  error: ApiError
} {
  return { ok: false, error: { code, message } }
}
