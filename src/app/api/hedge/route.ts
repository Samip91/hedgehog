import { NextResponse, type NextRequest } from 'next/server'
import { err, HedgeRequestSchema } from '@/shared/schemas'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * POST /api/hedge — parse ∥ warm-up → retrieve → rerank → propose (spec §6.2).
 * Rate-limited (10 / 10min per IP) — spends LLM tokens. Wired in feature: hedge-api.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = HedgeRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      err('BAD_REQUEST', 'A non-empty `prompt` is required.'),
      { status: 400 }
    )
  }

  return NextResponse.json(
    err('NOT_IMPLEMENTED', 'Hedge pipeline lands in feature: hedge-api.'),
    { status: 501 }
  )
}
