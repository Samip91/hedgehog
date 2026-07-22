import { NextResponse } from 'next/server'
import { ok } from '@/shared/schemas'
import {
  degradedKey,
  readHotCatalog,
  readLastSyncAt,
  redis,
} from '@/server/cache'
import { providers } from '@/server/providers/registry'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health — Redis-only status (spec AC 18–20). No auth, no `db`, no
 * provider calls: this must stay fast and safe to poll from anywhere.
 */
export async function GET() {
  const [catalog, lastSyncAt] = await Promise.all([
    readHotCatalog(),
    readLastSyncAt(),
  ])

  const names = [...providers.map(p => p.name), 'embedding']
  const flags = await redis.mget<(string | null)[]>(...names.map(degradedKey))
  const degraded = names.filter((_, i) => Boolean(flags[i]))

  return NextResponse.json(
    ok({
      lastSyncAt,
      catalogSize: catalog.length,
      degraded,
    })
  )
}
