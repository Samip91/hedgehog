import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/config/env'
import { err, ok } from '@/shared/schemas'
import {
  degradedKey,
  readHotCatalog,
  readLastSyncAt,
  redis,
} from '@/server/cache'
import { providers } from '@/server/providers/registry'
import { checkRateLimit, clientIp } from '@/server/rate-limit'
import { logger } from '@/server/log'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health — Redis-only status (spec AC 18–20). No auth, no `db`, no
 * provider calls: this must stay fast and safe to poll from anywhere. Rate
 * limited loosely (bucket `health`, AC 5) so normal polling never trips it.
 */
export async function GET(req: NextRequest) {
  const ip = clientIp(req)
  const rl = await checkRateLimit(
    'health',
    ip,
    env.RL_HEALTH_LIMIT,
    env.RL_HEALTH_WINDOW
  )
  if (!rl.ok) {
    return NextResponse.json(
      err('RATE_LIMITED', 'Too many requests. Try again shortly.'),
      {
        status: 429,
        headers: { 'Retry-After': String(env.RL_HEALTH_WINDOW) },
      }
    )
  }

  const [catalog, lastSyncAt] = await Promise.all([
    readHotCatalog(),
    readLastSyncAt(),
  ])

  const names = [...providers.map(p => p.name), 'embedding']
  const flags = await redis.mget<(string | null)[]>(...names.map(degradedKey))
  const degraded = names.filter((_, i) => Boolean(flags[i]))

  if (degraded.length) logger.warn('health degraded', { degraded })

  return NextResponse.json(
    ok({
      lastSyncAt,
      catalogSize: catalog.length,
      degraded,
    })
  )
}
