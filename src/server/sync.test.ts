import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  allMalformedMarkets,
  duplicateExternalIdMarkets,
  kalshiMarkets,
  malformedMarket,
  polymarketMarkets,
} from '@/server/fixtures/normalized-markets'
import type * as CacheModule from '@/server/cache'
import type { NormalizedMarket } from '@/server/providers/types'

const mocks = vi.hoisted(() => ({
  kalshiFetch: vi.fn(),
  polyFetch: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
  executeRaw: vi.fn(),
  embedBatch: vi.fn(),
  redisDel: vi.fn(),
  redisSet: vi.fn(),
  writeHotCatalog: vi.fn(),
  loggerWarn: vi.fn(),
}))

vi.mock('@/server/providers/registry', () => ({
  providers: [
    {
      name: 'kalshi',
      fetchOpenMarkets: mocks.kalshiFetch,
      fetchMarket: vi.fn(),
    },
    {
      name: 'polymarket',
      fetchOpenMarkets: mocks.polyFetch,
      fetchMarket: vi.fn(),
    },
  ],
}))

vi.mock('@/server/db', () => ({
  db: {
    marketSnapshot: { findMany: mocks.findMany, upsert: mocks.upsert },
    $executeRaw: mocks.executeRaw,
  },
}))

vi.mock('@/server/pipeline/embed', () => ({
  embedBatch: mocks.embedBatch,
}))

// hardening AC 16: sync.ts now logs a structured warn when `degraded` is
// non-empty. `@/server/log` does `import 'server-only'` — mock it out so
// `logger.warn` calls are assertable and stdout stays quiet during the run.
vi.mock('@/server/log', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: vi.fn(),
  },
  newErrorId: () => 'test-err-id',
}))

// cache.ts is `import 'server-only'` and constructs a real `Redis` client
// from env at module load — neutralize both so `importOriginal` below can
// actually execute the module (mirrors cache.test.ts's pattern).
vi.mock('server-only', () => ({}))
vi.mock('@/config/env', () => ({
  env: {
    UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'test-token',
  },
}))
vi.mock('@upstash/redis', () => ({
  // Only used so cache.ts's `new Redis(...)` doesn't throw at module load —
  // the real client is overridden by this file's `redis` mock below.
  Redis: vi.fn().mockImplementation(function RedisMock() {}),
}))

vi.mock('@/server/cache', async importOriginal => {
  const actual = await importOriginal<typeof CacheModule>()
  return {
    degradedKey: (name: string) => `degraded:${name}`,
    redis: { del: mocks.redisDel, set: mocks.redisSet },
    writeHotCatalog: mocks.writeHotCatalog,
    // Delegate to the real implementation instead of reimplementing it here,
    // so this mock can't drift from cache.ts's HotMarket-building logic
    // (reviewer finding: a hand-rolled copy would silently go stale).
    buildHotMarket: actual.buildHotMarket,
  }
})

import { runSync } from './sync'

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** Default happy-path stubs shared by every group; overridden per-test. */
function resetDefaults(): void {
  vi.clearAllMocks()
  mocks.findMany.mockResolvedValue([])
  mocks.upsert.mockResolvedValue(undefined)
  mocks.executeRaw.mockResolvedValue(undefined)
  mocks.embedBatch.mockResolvedValue([])
  mocks.writeHotCatalog.mockResolvedValue(undefined)
}

describe('runSync — provider isolation (AC 1–3)', () => {
  beforeEach(resetDefaults)

  it('one provider rejecting does not throw runSync, and the other still upserts (AC 1, 3)', async () => {
    mocks.kalshiFetch.mockRejectedValue(new Error('kalshi down'))
    mocks.polyFetch.mockResolvedValue(polymarketMarkets)

    const result = await runSync()

    expect(result.degraded).toContain('kalshi')
    expect(mocks.upsert).toHaveBeenCalledTimes(polymarketMarkets.length)
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_externalId: {
            provider: 'POLYMARKET',
            externalId: polymarketMarkets[0]?.externalId,
          },
        },
      })
    )
  })

  it('degraded is [] when both providers succeed (AC 2)', async () => {
    mocks.kalshiFetch.mockResolvedValue(kalshiMarkets)
    mocks.polyFetch.mockResolvedValue(polymarketMarkets)

    const result = await runSync()

    expect(result.degraded).toEqual([])
  })

  it('never throws/rejects even when both providers fail; both names are collected (AC 2, 3)', async () => {
    mocks.kalshiFetch.mockRejectedValue(new Error('kalshi down'))
    mocks.polyFetch.mockRejectedValue(new Error('poly down'))

    await expect(runSync()).resolves.toMatchObject({
      degraded: expect.arrayContaining(['kalshi', 'polymarket']),
    })
  })
})

describe('runSync — upsert idempotency (AC 6)', () => {
  beforeEach(() => {
    resetDefaults()
    mocks.kalshiFetch.mockResolvedValue(kalshiMarkets)
    mocks.polyFetch.mockResolvedValue(polymarketMarkets)
  })

  // Note: `db` is mocked, so this asserts the *upsert-key* contract runSync
  // relies on for idempotency (same (provider, externalId) key set both
  // runs, each upserted exactly once) — the strongest guarantee assertable
  // without a live Postgres. Actual row-count/no-duplicates/`updatedAt`
  // behavior is guaranteed by the `@@unique([provider, externalId])`
  // constraint + Prisma's `upsert`/`@updatedAt`, which is integration-level
  // and out of reach of a mocked-db unit test.
  it('running twice targets the same unique keys, once each, both times', async () => {
    const first = await runSync()
    const firstKeys = mocks.upsert.mock.calls.map(
      c => c[0].where.provider_externalId
    )

    mocks.upsert.mockClear()
    const second = await runSync()
    const secondKeys = mocks.upsert.mock.calls.map(
      c => c[0].where.provider_externalId
    )

    expect(first.upserted).toBe(kalshiMarkets.length + polymarketMarkets.length)
    expect(second.upserted).toBe(first.upserted)
    expect(secondKeys).toEqual(firstKeys)
    const dedupedKeys = new Set(
      secondKeys.map(
        (k: { provider: string; externalId: string }) =>
          `${k.provider}:${k.externalId}`
      )
    )
    expect(dedupedKeys.size).toBe(secondKeys.length) // no duplicate upsert calls within a run
  })
})

describe('runSync — malformed row skipped without aborting the run (AC 7)', () => {
  beforeEach(resetDefaults)

  it('fetched reflects the raw provider count; only valid rows are upserted', async () => {
    mocks.kalshiFetch.mockResolvedValue([...kalshiMarkets, malformedMarket])
    mocks.polyFetch.mockResolvedValue(polymarketMarkets)

    const result = await runSync()

    const rawCount = kalshiMarkets.length + 1 + polymarketMarkets.length
    expect(result.fetched).toBe(rawCount)
    expect(result.upserted).toBe(rawCount - 1)
    expect(mocks.upsert).toHaveBeenCalledTimes(rawCount - 1)
    expect(
      mocks.upsert.mock.calls.some(
        c => c[0].where.provider_externalId.externalId === 'K-MALFORMED'
      )
    ).toBe(false)
  })

  // Regression guard (round-3 hardening, Finding 1): the per-provider
  // rawRows>0 && validRows===0 check must NOT fire when a provider has one
  // bad row among otherwise-valid ones — kalshi still has validRows.length
  // > 0 here, so it must stay un-flagged.
  it('a provider with one bad row among valid ones is NOT flagged degraded', async () => {
    mocks.kalshiFetch.mockResolvedValue([...kalshiMarkets, malformedMarket])
    mocks.polyFetch.mockResolvedValue(polymarketMarkets)

    const result = await runSync()

    expect(result.degraded).not.toContain('kalshi')
    expect(mocks.redisDel).toHaveBeenCalledWith('degraded:kalshi')
    expect(mocks.redisSet).not.toHaveBeenCalledWith('degraded:kalshi', '1')
  })
})

describe('runSync — catalog-wipe guard on an all-malformed provider response (Finding 1)', () => {
  beforeEach(resetDefaults)

  // A fulfilled fetch that returned rows but where every row fails the
  // sync-boundary schema is a schema break, not a healthy-but-empty run —
  // it must be flagged degraded, and (since it leaves zero valid markets
  // overall in this test) the hot catalog write must be skipped so the last
  // good catalog is preserved rather than silently wiped.
  it('flags the provider degraded and skips writeHotCatalog when nothing valid survived the run', async () => {
    mocks.kalshiFetch.mockResolvedValue(allMalformedMarkets)
    // Polymarket also produces nothing usable this run, so the run-wide
    // `valid` set is empty — the scenario writeHotCatalog's guard exists for.
    mocks.polyFetch.mockRejectedValue(new Error('polymarket down'))

    const result = await runSync()

    expect(result.fetched).toBe(allMalformedMarkets.length)
    expect(result.upserted).toBe(0)
    expect(result.degraded).toContain('kalshi')
    expect(mocks.redisSet).toHaveBeenCalledWith('degraded:kalshi', '1')
    expect(mocks.writeHotCatalog).not.toHaveBeenCalled()
  })

  it('writes [] and does NOT flag the provider degraded on a genuinely empty (legit) fetch', async () => {
    mocks.kalshiFetch.mockResolvedValue([])
    mocks.polyFetch.mockResolvedValue([])

    const result = await runSync()

    expect(result.fetched).toBe(0)
    expect(result.degraded).not.toContain('kalshi')
    expect(result.degraded).not.toContain('polymarket')
    expect(mocks.redisDel).toHaveBeenCalledWith('degraded:kalshi')
    expect(mocks.redisDel).toHaveBeenCalledWith('degraded:polymarket')
    expect(mocks.writeHotCatalog).toHaveBeenCalledWith([], expect.any(Date))
  })
})

describe('runSync — dedup duplicate (provider, externalId) within one fetch (Finding 2)', () => {
  beforeEach(() => {
    resetDefaults()
    mocks.polyFetch.mockResolvedValue([])
  })

  it('upserts and embeds a duplicate externalId once, keeping the first occurrence', async () => {
    mocks.kalshiFetch.mockResolvedValue(duplicateExternalIdMarkets)
    mocks.embedBatch.mockResolvedValue([[0, 0, 0, 0]])

    const result = await runSync()

    const first = duplicateExternalIdMarkets[0]
    if (!first) throw new Error('fixture missing')

    expect(result.fetched).toBe(duplicateExternalIdMarkets.length) // raw count, pre-dedup
    expect(result.upserted).toBe(1)
    expect(mocks.upsert).toHaveBeenCalledTimes(1)
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_externalId: {
            provider: 'KALSHI',
            externalId: first.externalId,
          },
        },
      })
    )
    expect(mocks.embedBatch).toHaveBeenCalledWith([first.searchText])
    expect(result.embedded).toBe(1)
  })
})

describe('runSync — accurate embedded count on a partial vector write (Finding 3)', () => {
  beforeEach(() => {
    resetDefaults()
    mocks.kalshiFetch.mockResolvedValue(kalshiMarkets)
    mocks.polyFetch.mockResolvedValue(polymarketMarkets)
  })

  it('embedded reflects only the writes that succeeded before a mid-batch $executeRaw throw', async () => {
    const allMarkets = [...kalshiMarkets, ...polymarketMarkets]
    mocks.embedBatch.mockResolvedValue(allMarkets.map(() => [0, 0, 0, 0]))
    mocks.executeRaw
      .mockResolvedValueOnce(undefined) // 1st vector write lands
      .mockRejectedValueOnce(new Error('db down')) // 2nd throws mid-loop

    const result = await runSync()

    expect(result.embedded).toBe(1) // only the 1st write landed, not 0 and not 3
    expect(result.degraded).toContain('embedding')
    expect(mocks.redisSet).toHaveBeenCalledWith('degraded:embedding', '1')
    // Never resets to 0 in the catch — the 1 successful write still counts.
    expect(result.embedded).not.toBe(0)
  })

  it('confirms embedded === 0 when embedBatch itself rejects (no writes were ever attempted)', async () => {
    mocks.embedBatch.mockRejectedValue(new Error('NIM down'))

    const result = await runSync()

    expect(result.embedded).toBe(0)
    expect(mocks.executeRaw).not.toHaveBeenCalled()
  })
})

describe('runSync — hash-diff embedding (AC 9, 10, 12)', () => {
  const allMarkets = [...kalshiMarkets, ...polymarketMarkets]

  beforeEach(() => {
    resetDefaults()
    mocks.kalshiFetch.mockResolvedValue(kalshiMarkets)
    mocks.polyFetch.mockResolvedValue(polymarketMarkets)
  })

  it('first run (no existing rows): embedBatch is called with every searchText; embedded = all', async () => {
    mocks.findMany.mockResolvedValue([])
    mocks.embedBatch.mockResolvedValue(allMarkets.map(() => [0, 0, 0, 0]))

    const result = await runSync()

    const [calledTexts] = mocks.embedBatch.mock.calls[0] as [string[]]
    expect(new Set(calledTexts)).toEqual(
      new Set(allMarkets.map(m => m.searchText))
    )
    expect(result.embedded).toBe(allMarkets.length)
  })

  it('second run with unchanged fixtures: embedBatch input is empty, embedded = 0', async () => {
    mocks.findMany.mockResolvedValue(
      allMarkets.map(m => ({
        provider: m.provider.toUpperCase(),
        externalId: m.externalId,
        textHash: sha256(m.searchText),
      }))
    )
    mocks.embedBatch.mockResolvedValue([])

    const result = await runSync()

    expect(mocks.embedBatch).toHaveBeenCalledWith([])
    expect(result.embedded).toBe(0)
  })

  it('third run after mutating one market: embedBatch input is exactly that one market, embedded = 1', async () => {
    const original = kalshiMarkets[0]
    if (!original) throw new Error('fixture missing')
    const mutated: NormalizedMarket = {
      ...original,
      question: 'Will it snow in Miami on March 21?',
      searchText: 'Will it snow in Miami on March 21? Miami Weather weather',
    }
    mocks.kalshiFetch.mockResolvedValue([mutated, kalshiMarkets[1]])
    mocks.polyFetch.mockResolvedValue(polymarketMarkets)

    // Existing rows still carry the pre-mutation hashes.
    mocks.findMany.mockResolvedValue(
      allMarkets.map(m => ({
        provider: m.provider.toUpperCase(),
        externalId: m.externalId,
        textHash: sha256(m.searchText),
      }))
    )
    mocks.embedBatch.mockResolvedValue([[1, 1, 1, 1]])

    const result = await runSync()

    expect(mocks.embedBatch).toHaveBeenCalledWith([mutated.searchText])
    expect(result.embedded).toBe(1)
  })
})

describe('runSync — embedBatch failure (AC 13)', () => {
  beforeEach(() => {
    resetDefaults()
    mocks.kalshiFetch.mockResolvedValue(kalshiMarkets)
    mocks.polyFetch.mockResolvedValue(polymarketMarkets)
  })

  it("degraded includes 'embedding', embedded = 0, and no vector $executeRaw write happens", async () => {
    mocks.embedBatch.mockRejectedValue(new Error('NIM down'))

    const result = await runSync()

    expect(result.degraded).toContain('embedding')
    expect(result.embedded).toBe(0)
    expect(mocks.executeRaw).not.toHaveBeenCalled()
    // Scalar upsert (existing embedding/textHash left alone by `toUpsertData`
    // omitting `textHash` from `update`) still ran for every valid row.
    expect(mocks.upsert).toHaveBeenCalledTimes(
      kalshiMarkets.length + polymarketMarkets.length
    )
  })

  it('the run still completes (does not throw) when embedBatch throws', async () => {
    mocks.embedBatch.mockRejectedValue(new Error('NIM down'))
    await expect(runSync()).resolves.toBeDefined()
  })

  // Reviewer finding (blocker): the in-memory SyncResult.degraded alone
  // isn't enough — /api/health reads Redis, so the flag must be persisted
  // there too, symmetrically with the provider degradedKeys (AC 17).
  it('persists degraded:embedding to Redis on failure', async () => {
    mocks.embedBatch.mockRejectedValue(new Error('NIM down'))

    await runSync()

    expect(mocks.redisSet).toHaveBeenCalledWith('degraded:embedding', '1')
  })

  it('clears degraded:embedding in Redis on a successful embed run', async () => {
    const allMarkets = [...kalshiMarkets, ...polymarketMarkets]
    mocks.embedBatch.mockResolvedValue(allMarkets.map(() => [0, 0, 0, 0]))

    await runSync()

    expect(mocks.redisDel).toHaveBeenCalledWith('degraded:embedding')
    expect(mocks.redisSet).not.toHaveBeenCalledWith('degraded:embedding', '1')
  })
})

describe('runSync — hot catalog write gating (AC 16)', () => {
  beforeEach(resetDefaults)

  it('writeHotCatalog is called when at least one provider succeeds, even if the other fails', async () => {
    mocks.kalshiFetch.mockRejectedValue(new Error('down'))
    mocks.polyFetch.mockResolvedValue(polymarketMarkets)

    await runSync()

    expect(mocks.writeHotCatalog).toHaveBeenCalledOnce()
    const [written] = mocks.writeHotCatalog.mock.calls[0] as [unknown[]]
    expect(written).toHaveLength(polymarketMarkets.length)
  })

  it('writeHotCatalog is NOT called when every provider fails', async () => {
    mocks.kalshiFetch.mockRejectedValue(new Error('down'))
    mocks.polyFetch.mockRejectedValue(new Error('down too'))

    await runSync()

    expect(mocks.writeHotCatalog).not.toHaveBeenCalled()
  })
})

describe('runSync — degradedKey set/cleared (AC 17)', () => {
  beforeEach(resetDefaults)

  it('a failed fetch sets degraded:{provider}; the next successful fetch clears it', async () => {
    mocks.kalshiFetch.mockRejectedValueOnce(new Error('down'))
    mocks.polyFetch.mockResolvedValue(polymarketMarkets)

    await runSync()

    expect(mocks.redisSet).toHaveBeenCalledWith('degraded:kalshi', '1')
    expect(mocks.redisDel).toHaveBeenCalledWith('degraded:polymarket')

    mocks.redisSet.mockClear()
    mocks.redisDel.mockClear()
    mocks.kalshiFetch.mockResolvedValueOnce(kalshiMarkets)

    await runSync()

    expect(mocks.redisDel).toHaveBeenCalledWith('degraded:kalshi')
    expect(mocks.redisSet).not.toHaveBeenCalledWith('degraded:kalshi', '1')
  })
})

describe('runSync — logs a structured warn when degraded is non-empty (hardening AC 16)', () => {
  beforeEach(resetDefaults)

  it("a degraded provider → logger.warn('sync degraded', { degraded }) with the same array as the result", async () => {
    mocks.kalshiFetch.mockRejectedValue(new Error('kalshi down'))
    mocks.polyFetch.mockResolvedValue(polymarketMarkets)

    const result = await runSync()

    expect(mocks.loggerWarn).toHaveBeenCalledOnce()
    expect(mocks.loggerWarn).toHaveBeenCalledWith('sync degraded', {
      degraded: result.degraded,
    })
  })

  it('degraded is [] (both providers healthy) → logger.warn is never called', async () => {
    mocks.kalshiFetch.mockResolvedValue(kalshiMarkets)
    mocks.polyFetch.mockResolvedValue(polymarketMarkets)

    const result = await runSync()

    expect(result.degraded).toEqual([])
    expect(mocks.loggerWarn).not.toHaveBeenCalled()
  })

  it('an embedding failure alone still triggers the degraded warn', async () => {
    mocks.kalshiFetch.mockResolvedValue(kalshiMarkets)
    mocks.polyFetch.mockResolvedValue(polymarketMarkets)
    mocks.embedBatch.mockRejectedValue(new Error('NIM down'))

    const result = await runSync()

    expect(result.degraded).toContain('embedding')
    expect(mocks.loggerWarn).toHaveBeenCalledWith('sync degraded', {
      degraded: result.degraded,
    })
  })
})
