import type { SavedHedge } from '@prisma/client'
import { NextResponse, type NextRequest } from 'next/server'
import { getAnonId } from '@/server/anon'
import { db } from '@/server/db'
import { findSnapshot } from '@/server/hedges/snapshot'
import { savedHedgeToView } from '@/server/hedges/view'
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
 * 404 (no existence leak, spec AC 14). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const anonId = await getAnonId()

  const row = await loadOwned(id, anonId)
  if (row === null) return notFound()

  const snapshot = await findSnapshot(row.provider, row.externalId)
  return NextResponse.json(ok(savedHedgeToView(row, snapshot)))
}

/** DELETE /api/hedges/[id] — owned only. Foreign/missing → identical 404
 * (matches GET detail, spec AC 22). */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const anonId = await getAnonId()

  const row = await loadOwned(id, anonId)
  if (row === null) return notFound()

  await db.savedHedge.delete({ where: { id } })
  return NextResponse.json(ok({ id }))
}
