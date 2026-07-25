import { NextResponse } from 'next/server'
import { logger, newErrorId } from '@/server/log'
import { err } from '@/shared/schemas'

/**
 * Shared `catch` tail for the saved-hedges routes (GET/POST `/api/hedges`,
 * GET/DELETE `/api/hedges/[id]`): stamp + log an errorId, return the generic
 * 500 envelope. `/api/hedge` and the cron route keep their own catch blocks
 * — their envelopes (`PIPELINE_ERROR` / `SYNC_FAILED`) differ.
 */
export function logAndFail(route: string, e: unknown): NextResponse {
  const errorId = newErrorId()
  logger.error(`${route} failed`, {
    route,
    errorId,
    err: e instanceof Error ? e.message : String(e),
  })
  return NextResponse.json(err('INTERNAL', 'Something went wrong.'), {
    status: 500,
  })
}
