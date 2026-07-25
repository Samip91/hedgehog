import { NextResponse, type NextRequest } from 'next/server'
import { err, ok, HedgeRequestSchema } from '@/shared/schemas'
import { HedgeProposalSchema } from '@/shared/proposal'
import { parseRisk } from '@/server/pipeline/parse'
import { retrieveCandidates } from '@/server/pipeline/retrieve'
import { rerank } from '@/server/pipeline/rank'
import { buildProposal } from '@/server/pipeline/propose'
import {
  checkHedgeRateLimit,
  clientIp,
  HEDGE_RATE_WINDOW_SECONDS,
} from '@/server/rate-limit'
import { logger, newErrorId } from '@/server/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * POST /api/hedge — parse → retrieve → rerank → propose (spec §6.2), the
 * only route that runs the full pipeline. Rate-limited first (ADR 005, AC 9)
 * so a blocked request spends no LLM tokens; then the existing body
 * validation; then the four stages in a single `try/catch` mapping any
 * propagated infra failure (e.g. retrieve's Postgres read) to `500` (AC 7).
 * No provider client is imported here — retrieval reads Postgres/pgvector.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const rateLimit = await checkHedgeRateLimit(ip)
  if (!rateLimit.ok) {
    return NextResponse.json(
      err('RATE_LIMITED', 'Too many requests. Try again shortly.'),
      {
        status: 429,
        headers: { 'Retry-After': String(HEDGE_RATE_WINDOW_SECONDS) },
      }
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = HedgeRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      err('BAD_REQUEST', 'A non-empty `prompt` is required.'),
      { status: 400 }
    )
  }

  try {
    const spec = await parseRisk(parsed.data.prompt)
    const candidates = await retrieveCandidates(spec, parsed.data.prompt)
    const matches = await rerank(spec, candidates)
    const proposal = await buildProposal(spec, matches)
    // Runtime backstop: the response schema pins payoff fields to `.finite()`
    // and `price` to (0,1). The up-front price guard in `buildProposal` should
    // make this unreachable, but validating here means a malformed proposal
    // becomes a 500 rather than ever reaching the client as a 200 (ADR 005 /
    // review finding 2).
    const validated = HedgeProposalSchema.safeParse(proposal)
    if (!validated.success) {
      return NextResponse.json(
        err('PIPELINE_ERROR', 'Could not build a hedge right now.'),
        { status: 500 }
      )
    }
    return NextResponse.json(ok(validated.data))
  } catch (e) {
    const errorId = newErrorId()
    logger.error('POST /api/hedge failed', {
      route: 'POST /api/hedge',
      errorId,
      err: e instanceof Error ? e.message : String(e),
    })
    return NextResponse.json(
      err('PIPELINE_ERROR', 'Could not build a hedge right now.'),
      { status: 500 }
    )
  }
}
