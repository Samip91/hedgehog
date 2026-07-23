import { Prisma } from '@prisma/client'
import type { MarketSnapshot, SavedHedge } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import type { HedgeSpec } from '@/shared/schemas'
import { savedHedgeToView } from './view'

/**
 * `savedHedgeToView()` unit tests (spec `docs/features/saved-hedges/spec.md`
 * §"Lazy settlement", plan.md's "Pure core" layer). Confirms Decimal→number
 * coercion, the full `SavedHedgeView` field mapping, and that `settle()` is
 * actually invoked (status/currentPrice/simulatedPnlUsd reflect the joined
 * snapshot) for an OPEN snapshot, a RESOLVED snapshot, and `snapshot: null`.
 */

function fakeSpec(): HedgeSpec {
  return {
    riskDescription: 'Financial loss from rain on wedding day',
    domain: 'weather',
    direction: 'happens',
    exposureUsd: 500,
    deadline: '2026-03-21',
    location: 'Miami',
    asset: null,
    threshold: null,
    confidence: 'high',
    clarificationNeeded: null,
  }
}

function fakeRow(overrides: Partial<SavedHedge> = {}): SavedHedge {
  return {
    id: 'hedge-1',
    anonId: 'anon-1',
    prompt: 'Will it rain on my wedding day?',
    spec: fakeSpec() as unknown as SavedHedge['spec'],
    provider: 'KALSHI',
    externalId: 'K-TEST',
    question: 'Will it rain in Miami on March 21?',
    side: 'YES',
    entryPrice: new Prisma.Decimal('0.4'),
    stakeUsd: new Prisma.Decimal('100'),
    shares: new Prisma.Decimal('250'),
    status: 'OPEN',
    settledPnlUsd: null,
    createdAt: new Date('2026-03-01T00:00:00Z'),
    updatedAt: new Date('2026-03-01T00:00:00Z'),
    ...overrides,
  }
}

function fakeSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    id: 'snap-1',
    provider: 'KALSHI',
    externalId: 'K-TEST',
    question: 'Will it rain in Miami on March 21?',
    eventTitle: null,
    searchText: 'Will it rain in Miami on March 21?',
    textHash: 'hash',
    category: 'weather',
    yesPrice: new Prisma.Decimal('0.5'),
    noPrice: new Prisma.Decimal('0.5'),
    volumeUsd: null,
    liquidityUsd: null,
    closeTime: null,
    status: 'OPEN',
    resolvedYes: null,
    rawTrimmed: {},
    createdAt: new Date('2026-03-01T00:00:00Z'),
    updatedAt: new Date('2026-03-01T00:00:00Z'),
    ...overrides,
  }
}

describe('savedHedgeToView — Decimal→number coercion + field mapping', () => {
  it('coerces every Decimal field to a plain number and maps the display fields', () => {
    const row = fakeRow()
    const view = savedHedgeToView(row, null)

    expect(view.id).toBe(row.id)
    expect(view.prompt).toBe(row.prompt)
    expect(view.question).toBe(row.question)
    expect(view.side).toBe(row.side)
    expect(view.entryPrice).toBe(0.4)
    expect(typeof view.entryPrice).toBe('number')
    expect(view.stakeUsd).toBe(100)
    expect(typeof view.stakeUsd).toBe('number')
  })

  it('null snapshot → OPEN status, currentPrice null, simulatedPnlUsd null (settle is invoked)', () => {
    const row = fakeRow()
    const view = savedHedgeToView(row, null)

    expect(view.status).toBe('OPEN')
    expect(view.currentPrice).toBeNull()
    expect(view.simulatedPnlUsd).toBeNull()
  })
})

describe('savedHedgeToView — OPEN snapshot mark-to-market (settle wired through)', () => {
  it('side YES → currentPrice = snapshot.yesPrice (coerced number), pnl = shares*price - stakeUsd', () => {
    const row = fakeRow({
      side: 'YES',
      stakeUsd: new Prisma.Decimal('100'),
      shares: new Prisma.Decimal('250'),
    })
    const snapshot = fakeSnapshot({
      status: 'OPEN',
      yesPrice: new Prisma.Decimal('0.6'),
      noPrice: new Prisma.Decimal('0.4'),
    })

    const view = savedHedgeToView(row, snapshot)

    expect(view.status).toBe('OPEN')
    expect(view.currentPrice).toBe(0.6)
    expect(typeof view.currentPrice).toBe('number')
    expect(view.simulatedPnlUsd).toBe(50) // 250*0.6 - 100
  })
})

describe('savedHedgeToView — RESOLVED snapshot (settle wired through)', () => {
  it('resolvedYes matches side → RESOLVED_WIN, pnl = shares*1 - stakeUsd', () => {
    const row = fakeRow({
      side: 'YES',
      stakeUsd: new Prisma.Decimal('100'),
      shares: new Prisma.Decimal('250'),
    })
    const snapshot = fakeSnapshot({
      status: 'RESOLVED',
      resolvedYes: true,
      yesPrice: new Prisma.Decimal('1'),
      noPrice: new Prisma.Decimal('0'),
    })

    const view = savedHedgeToView(row, snapshot)

    expect(view.status).toBe('RESOLVED_WIN')
    expect(view.currentPrice).toBeNull()
    expect(view.simulatedPnlUsd).toBe(150)
  })

  it('resolvedYes opposite side → RESOLVED_LOSS, pnl = -stakeUsd', () => {
    const row = fakeRow({
      side: 'NO',
      stakeUsd: new Prisma.Decimal('80'),
      shares: new Prisma.Decimal('200'),
    })
    const snapshot = fakeSnapshot({
      status: 'RESOLVED',
      resolvedYes: true,
      yesPrice: new Prisma.Decimal('1'),
      noPrice: new Prisma.Decimal('0'),
    })

    const view = savedHedgeToView(row, snapshot)

    expect(view.status).toBe('RESOLVED_LOSS')
    expect(view.currentPrice).toBeNull()
    expect(view.simulatedPnlUsd).toBe(-80)
  })
})
