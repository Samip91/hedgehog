import { NextResponse, type NextRequest } from 'next/server'
import { err } from '@/shared/schemas'

export const dynamic = 'force-dynamic'

interface Ctx {
  params: Promise<{ key: string }>
}

/**
 * GET /api/markets/[key] — the single live-price exception (spec §3).
 * Fetches this one market's live price directly (5s timeout, snapshot fallback
 * with a "stale as of" badge). Wired in feature: live-price.
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { key } = await params
  return NextResponse.json(
    err('NOT_IMPLEMENTED', `Live price for ${key} lands in feature: live-price.`),
    { status: 501 }
  )
}
