import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/config/env'
import { err, ok } from '@/shared/schemas'
import { runSync } from '@/server/sync'
import { logger, newErrorId } from '@/server/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Protected background sync. Vercel Cron sends `Authorization: Bearer <secret>`.
 * The request path never hits providers — only this cron route does.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json(err('UNAUTHORIZED', 'Invalid cron secret'), {
      status: 401,
    })
  }

  try {
    const result = await runSync()
    return NextResponse.json(ok(result))
  } catch (e) {
    const message = e instanceof Error ? e.message : 'sync failed'
    const errorId = newErrorId()
    logger.error('GET /api/cron/sync failed', {
      route: 'GET /api/cron/sync',
      errorId,
      err: message,
    })
    return NextResponse.json(err('SYNC_FAILED', message), { status: 500 })
  }
}
