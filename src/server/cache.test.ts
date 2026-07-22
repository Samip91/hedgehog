import { beforeEach, describe, expect, it, vi } from 'vitest'

// cache.ts is `import 'server-only'` — neutralize the marker for the node
// test environment (mirrors how Next strips it for Server Components/routes).
vi.mock('server-only', () => ({}))

vi.mock('@/config/env', () => ({
  env: {
    UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'test-token',
  },
}))

const mocks = vi.hoisted(() => {
  const multiChain = {
    set: vi.fn(),
    exec: vi.fn().mockResolvedValue([]),
  }
  multiChain.set.mockReturnValue(multiChain)
  return {
    multi: vi.fn(() => multiChain),
    multiChain,
    get: vi.fn(),
  }
})

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(function RedisMock(this: {
    multi: typeof mocks.multi
    get: typeof mocks.get
  }) {
    this.multi = mocks.multi
    this.get = mocks.get
  }),
}))

import {
  CATALOG_KEY,
  LAST_SYNC_KEY,
  type HotMarket,
  readHotCatalog,
  readLastSyncAt,
  writeHotCatalog,
} from './cache'

const sampleMarket: HotMarket = {
  provider: 'kalshi',
  externalId: 'K-1',
  searchText: 'Will it rain in Miami?',
  yesPrice: 0.24,
  noPrice: 0.76,
  category: 'weather',
  status: 'open',
  closeTime: '2026-08-01T00:00:00.000Z',
  volumeUsd: 100,
  liquidityUsd: 200,
}

describe('writeHotCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.multiChain.set.mockReturnValue(mocks.multiChain)
    mocks.multiChain.exec.mockResolvedValue([])
  })

  // AC 15: the catalog write is all-or-nothing per run — one pipelined
  // multi() call, not incremental separate `set`s.
  it('writes both keys through a single pipelined multi().exec() call', async () => {
    await writeHotCatalog([sampleMarket], new Date('2026-07-21T00:00:00Z'))

    expect(mocks.multi).toHaveBeenCalledOnce()
    expect(mocks.multiChain.set).toHaveBeenCalledTimes(2)
    expect(mocks.multiChain.set).toHaveBeenNthCalledWith(1, CATALOG_KEY, [
      sampleMarket,
    ])
    expect(mocks.multiChain.set).toHaveBeenNthCalledWith(
      2,
      LAST_SYNC_KEY,
      '2026-07-21T00:00:00.000Z'
    )
    expect(mocks.multiChain.exec).toHaveBeenCalledOnce()
  })

  // AC 14: the written catalog entries carry no embedding/vector field —
  // vectors stay in Postgres, never cached in Redis.
  it('written catalog entries have no embedding/vector field', async () => {
    await writeHotCatalog([sampleMarket], new Date())

    const [, writtenMarkets] = mocks.multiChain.set.mock.calls[0] as [
      string,
      Record<string, unknown>[],
    ]
    for (const entry of writtenMarkets) {
      expect(entry).not.toHaveProperty('embedding')
      expect(entry).not.toHaveProperty('vector')
      expect(Object.keys(entry).sort()).toEqual(
        [
          'provider',
          'externalId',
          'searchText',
          'yesPrice',
          'noPrice',
          'category',
          'status',
          'closeTime',
          'volumeUsd',
          'liquidityUsd',
        ].sort()
      )
    }
  })
})

describe('readHotCatalog / readLastSyncAt — pre-first-sync (AC 19)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('readHotCatalog resolves [] when the catalog key has never been written', async () => {
    mocks.get.mockResolvedValueOnce(null)
    await expect(readHotCatalog()).resolves.toEqual([])
  })

  it('readLastSyncAt resolves null when sync has never run', async () => {
    mocks.get.mockResolvedValueOnce(null)
    await expect(readLastSyncAt()).resolves.toBeNull()
  })

  // Defensive: a poisoned/malformed catalog value degrades to [] rather than
  // throwing — keeps /api/health at a 200, never a 500 (AC 19's intent).
  it('readHotCatalog fails open to [] on a malformed cached value', async () => {
    mocks.get.mockResolvedValueOnce([{ not: 'a valid HotMarket' }])
    await expect(readHotCatalog()).resolves.toEqual([])
  })

  it('readHotCatalog returns parsed markets when the catalog is populated', async () => {
    mocks.get.mockResolvedValueOnce([sampleMarket])
    await expect(readHotCatalog()).resolves.toEqual([sampleMarket])
  })
})

describe('HotMarketSchema.closeTime — enforced ISO datetime (Finding 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('readHotCatalog fails open to [] when closeTime is not a valid ISO datetime', async () => {
    mocks.get.mockResolvedValueOnce([
      { ...sampleMarket, closeTime: 'not-a-date' },
    ])
    await expect(readHotCatalog()).resolves.toEqual([])
  })

  it('readHotCatalog round-trips a market with a valid ISO closeTime intact', async () => {
    const withIsoCloseTime = {
      ...sampleMarket,
      closeTime: new Date('2026-08-01T00:00:00Z').toISOString(),
    }
    mocks.get.mockResolvedValueOnce([withIsoCloseTime])
    await expect(readHotCatalog()).resolves.toEqual([withIsoCloseTime])
  })
})
