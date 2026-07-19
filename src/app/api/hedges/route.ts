import { NextResponse, type NextRequest } from 'next/server'
import { err, SaveHedgeRequestSchema } from '@/shared/schemas'

export const dynamic = 'force-dynamic'

/** GET /api/hedges — list saved hedges for the anon cookie (spec §3, screen 3). */
export async function GET(_req: NextRequest) {
  return NextResponse.json(
    err('NOT_IMPLEMENTED', 'Listing lands in feature: saved-hedges.'),
    { status: 501 }
  )
}

/** POST /api/hedges — idempotent save (upsert on client-generated UUID). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = SaveHedgeRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(err('BAD_REQUEST', 'Invalid hedge payload.'), {
      status: 400,
    })
  }

  return NextResponse.json(
    err('NOT_IMPLEMENTED', 'Idempotent save lands in feature: saved-hedges.'),
    { status: 501 }
  )
}
