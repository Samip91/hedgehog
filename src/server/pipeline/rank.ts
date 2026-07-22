import { z } from 'zod'
import { env } from '@/config/env'
import type { HedgeSpec } from '@/shared/schemas'
import type { Candidate } from './retrieve'
import {
  chatComplete as sharedChatComplete,
  extractJsonObject,
  tryChat,
  type ChatFn,
} from './nim-chat'
import { buildRerankMessages, buildRerankRetryMessages } from './rerank-prompt'

/**
 * Stage 3 — LLM rerank (spec §6.4). Large model. Returns up to 3 ranked
 * matches, each with the correct `side` from the user's hedging perspective,
 * a qualitative relevance label, and one-sentence reasoning.
 * Guardrail: return an empty list rather than force a match.
 *
 * Structurally identical to `parseRisk` (ADR 004): build messages, call the
 * chat seam, validate, one retry feeding the validation error back, then a
 * pure mapping. Any unrecoverable failure resolves to `[]` — never throws.
 */
export interface RankedMatch {
  readonly candidate: Candidate
  readonly side: 'YES' | 'NO'
  readonly relevance: 'high' | 'partial' | 'weak'
  readonly reasoning: string
}

export interface RerankDeps {
  chat?: ChatFn
}

/** LLM wire shape — validated before any mapping to `RankedMatch` occurs. */
export const RerankResponseSchema = z.object({
  matches: z.array(
    z.object({
      externalId: z.string().min(1),
      provider: z.enum(['kalshi', 'polymarket']),
      side: z.enum(['YES', 'NO']),
      relevance: z.enum(['high', 'partial', 'weak']),
      reasoning: z
        .string()
        .min(1)
        .max(200)
        .refine(s => !s.includes('\n'), 'reasoning must not contain a newline'),
    })
  ),
})
export type RerankResponse = z.infer<typeof RerankResponseSchema>

type ValidateResult =
  { success: true; data: RerankResponse } | { success: false; issues: string }

/** JSON extraction + `RerankResponseSchema.safeParse`, uniform failure shape. */
function validateRerank(content: string): ValidateResult {
  const obj = extractJsonObject(content)
  if (obj === null) {
    return { success: false, issues: 'response was not valid JSON' }
  }
  const parsed = RerankResponseSchema.safeParse(obj)
  if (parsed.success) return { success: true, data: parsed.data }
  const issues = JSON.stringify(
    parsed.error.issues.map(i => ({ path: i.path, message: i.message }))
  )
  return { success: false, issues }
}

const RELEVANCE_RANK: Record<
  RerankResponse['matches'][number]['relevance'],
  number
> = { high: 0, partial: 1, weak: 2 }

/**
 * Pure mapping from the validated wire shape to `RankedMatch[]` (AC 3/4/5):
 * subset-only by `${provider}:${externalId}` (unknown ids dropped, no
 * fabrication), dedupe repeats (keep first), sort by relevance with a
 * stable input-candidate-order tie-break, then `.slice(0, 3)`.
 */
export function mapMatches(
  data: RerankResponse,
  candidates: readonly Candidate[]
): RankedMatch[] {
  const byKey = new Map<string, { candidate: Candidate; order: number }>()
  candidates.forEach((candidate, order) => {
    byKey.set(`${candidate.market.provider}:${candidate.market.externalId}`, {
      candidate,
      order,
    })
  })

  const seen = new Set<string>()
  const mapped: { match: RankedMatch; order: number }[] = []

  for (const m of data.matches) {
    const key = `${m.provider}:${m.externalId}`
    if (seen.has(key)) continue
    const found = byKey.get(key)
    if (found === undefined) continue
    seen.add(key)
    mapped.push({
      match: {
        candidate: found.candidate,
        side: m.side,
        relevance: m.relevance,
        reasoning: m.reasoning,
      },
      order: found.order,
    })
  }

  mapped.sort((a, b) => {
    const rankDiff =
      RELEVANCE_RANK[a.match.relevance] - RELEVANCE_RANK[b.match.relevance]
    if (rankDiff !== 0) return rankDiff
    return a.order - b.order
  })

  return mapped.slice(0, 3).map(m => m.match)
}

/**
 * `rerank(spec, candidates, deps={})`:
 *   candidates.length === 0        → []
 *   raw1 = tryChat(...); null      → []
 *   r1 valid                       → mapMatches(r1.data, candidates) (empty
 *                                     matches → [], NO retry — AC 5)
 *   r1 invalid                     → ONE retry feeding r1's issues (AC 8)
 *   raw2 null | r2 invalid         → [] (AC 9, never a 3rd call)
 *   r2 valid                       → mapMatches(r2.data, candidates)
 */
export async function rerank(
  spec: HedgeSpec,
  candidates: Candidate[],
  deps: RerankDeps = {}
): Promise<RankedMatch[]> {
  if (candidates.length === 0) return []

  const chat: ChatFn =
    deps.chat ??
    (messages => sharedChatComplete(messages, env.LLM_RERANK_MODEL))

  const messages = buildRerankMessages(spec, candidates)

  const raw1 = await tryChat(chat, messages)
  if (raw1 === null) return []

  const r1 = validateRerank(raw1)
  if (r1.success) return mapMatches(r1.data, candidates)

  const retryMessages = buildRerankRetryMessages(messages, raw1, r1.issues)

  const raw2 = await tryChat(chat, retryMessages)
  if (raw2 === null) return []

  const r2 = validateRerank(raw2)
  return r2.success ? mapMatches(r2.data, candidates) : []
}
