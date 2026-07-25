import type { SavedHedge } from '@prisma/client'
import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/config/env'
import { getAnonId } from '@/server/anon'
import { db } from '@/server/db'
import { logAndFail } from '@/server/hedges/errors'
import { findSnapshot } from '@/server/hedges/snapshot'
import { savedHedgeToView } from '@/server/hedges/view'
import { checkRateLimit, clientIp } from '@/server/rate-limit'
import { err, ok } from '@/shared/schemas'

export const dynamic = 'force-dynamic'

interface Ctx {
  // Next 16: route params are async — always await.
  params: Promise<{ id: string }>
}

/** Shared by GET/DELETE: the row, but only if it exists *and* is owned by
 * `anonId` — otherwise `null` (missing and foreign collapse to the same
 * "not found", no existence leak, spec AC 14, 22). */
async function loadOwned(
  id: string,
  anonId: string | null
): Promise<SavedHedge | null> {
  const row = await db.savedHedge.findUnique({ where: { id } })
  return row !== null && anonId !== null && row.anonId === anonId ? row : null
}

function notFound(): NextResponse {
  return NextResponse.json(err('NOT_FOUND', 'Saved hedge not found.'), {
    status: 404,
  })
}

/** GET /api/hedges/[id] — detail, owned only. Foreign/missing → identical
 * 404 (no existence leak, spec AC 14). Rate limited first (bucket
 * `hedges:read`, hardening AC 3), before any DB read. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const ip = clientIp(req)
  const rl = await checkRateLimit(
    'hedges:read',
    ip,
    env.RL_HEDGES_READ_LIMIT,
    env.RL_HEDGES_READ_WINDOW
  )
  if (!rl.ok) {
    return NextResponse.json(
      err('RATE_LIMITED', 'Too many requests. Try again shortly.'),
      {
        status: 429,
        headers: { 'Retry-After': String(env.RL_HEDGES_READ_WINDOW) },
      }
    )
  }

  try {
    const { id } = await params
    const anonId = await getAnonId()

    const row = await loadOwned(id, anonId)
    if (row === null) return notFound()

    const snapshot = await findSnapshot(row.provider, row.externalId)
    return NextResponse.json(ok(savedHedgeToView(row, snapshot)))
  } catch (e) {
    return logAndFail('GET /api/hedges/[id]', e)
  }
}

/** DELETE /api/hedges/[id] — owned only. Foreign/missing → identical 404
 * (matches GET detail, spec AC 22). Rate limited first (bucket
 * `hedges:delete`, hardening AC 4), before any DB write. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const ip = clientIp(req)
  const rl = await checkRateLimit(
    'hedges:delete',
    ip,
    env.RL_HEDGES_DELETE_LIMIT,
    env.RL_HEDGES_DELETE_WINDOW
  )
  if (!rl.ok) {
    return NextResponse.json(
      err('RATE_LIMITED', 'Too many requests. Try again shortly.'),
      {
        status: 429,
        headers: { 'Retry-After': String(env.RL_HEDGES_DELETE_WINDOW) },
      }
    )
  }

  try {
    const { id } = await params
    const anonId = await getAnonId()

    const row = await loadOwned(id, anonId)
    if (row === null) return notFound()

    await db.savedHedge.delete({ where: { id } })
    return NextResponse.json(ok({ id }))
  } catch (e) {
    return logAndFail('DELETE /api/hedges/[id]', e)
  }
}
