import { Prisma, type Provider } from '@prisma/client'
import { NextResponse, type NextRequest } from 'next/server'
import { getAnonId, setAnonCookie } from '@/server/anon'
import { db } from '@/server/db'
import { findSnapshot } from '@/server/hedges/snapshot'
import { savedHedgeToView } from '@/server/hedges/view'
import { err, ok, SaveHedgeRequestSchema } from '@/shared/schemas'

export const dynamic = 'force-dynamic'

/**
 * GET /api/hedges — list saved hedges owned by the caller's `anonId` cookie
 * (spec §3, screen 3). Read-only: never mints a cookie (AC 3); no cookie at
 * all means "owns nothing" → empty list, not an error (AC 3, 11).
 */
export async function GET(_req: NextRequest) {
  const anonId = await getAnonId()
  if (anonId === null) {
    return NextResponse.json(ok([]))
  }

  const rows = await db.savedHedge.findMany({
    where: { anonId },
    orderBy: { createdAt: 'desc' },
  })

  // One batched snapshot read (not N+1): distinct (provider, externalId)
  // pairs → a single `findMany` → Map join keyed by the same pair.
  const pairs = new Map<string, { provider: Provider; externalId: string }>()
  for (const row of rows) {
    pairs.set(`${row.provider}:${row.externalId}`, {
      provider: row.provider,
      externalId: row.externalId,
    })
  }
  const snapshots =
    pairs.size > 0
      ? await db.marketSnapshot.findMany({
          where: { OR: [...pairs.values()] },
        })
      : []
  const snapshotByKey = new Map(
    snapshots.map(s => [`${s.provider}:${s.externalId}`, s])
  )

  const views = rows.map(row =>
    savedHedgeToView(
      row,
      snapshotByKey.get(`${row.provider}:${row.externalId}`) ?? null
    )
  )
  return NextResponse.json(ok(views))
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
  const input = parsed.data

  let anonId = await getAnonId()
  const mintedCookie = anonId === null
  if (anonId === null) {
    anonId = crypto.randomUUID()
  }

  // Ownership fixed at create (ADR 007 / spec AC 8): a plain upsert can't
  // express "reject a foreign row", so guard with a findUnique first. A
  // same-anon double-click still lands on the atomic upsert below (AC 6).
  const existing = await db.savedHedge.findUnique({
    where: { id: input.id },
    select: { anonId: true },
  })
  if (existing !== null && existing.anonId !== anonId) {
    return NextResponse.json(
      err('FORBIDDEN', 'This hedge belongs to a different session.'),
      { status: 403 }
    )
  }

  // `input.provider` is already the uppercase enum literal ('KALSHI' |
  // 'POLYMARKET') the client sends — assign directly, never `.toUpperCase()`
  // (the casing boundary is `toProviderEnum`, which converts FROM the
  // provider clients' lowercase; this request is already at the DB shape).
  const provider: Provider = input.provider
  const entryPrice = new Prisma.Decimal(input.entryPrice)
  const stakeUsd = new Prisma.Decimal(input.stakeUsd)
  const shares = stakeUsd.div(entryPrice)

  const contentFields = {
    prompt: input.prompt,
    spec: input.spec,
    provider,
    externalId: input.externalId,
    question: input.question,
    side: input.side,
    entryPrice,
    stakeUsd,
    shares,
  }

  const row = await db.savedHedge.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      anonId,
      ...contentFields,
      status: 'OPEN',
      settledPnlUsd: null,
    },
    // Content only — never `anonId`/`createdAt` (ownership/creation stay fixed).
    update: contentFields,
  })

  const snapshot = await findSnapshot(provider, input.externalId)
  const view = savedHedgeToView(row, snapshot)

  const res = NextResponse.json(ok(view))
  if (mintedCookie) {
    setAnonCookie(res, anonId)
  }
  return res
}
