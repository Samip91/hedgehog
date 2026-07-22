import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readHotCatalog: vi.fn(),
  readLastSyncAt: vi.fn(),
  mget: vi.fn(),
  kalshiFetch: vi.fn(),
  polyFetch: vi.fn(),
}))

vi.mock('@/server/cache', () => ({
  degradedKey: (name: string) => `degraded:${name}`,
  readHotCatalog: mocks.readHotCatalog,
  readLastSyncAt: mocks.readLastSyncAt,
  redis: { mget: mocks.mget },
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

import { GET } from './route'

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // AC 18: populated Redis → correct {lastSyncAt, catalogSize, degraded} triple, 200.
  it('returns 200 with the status triple sourced from Redis', async () => {
    mocks.readHotCatalog.mockResolvedValue([
      { externalId: 'a' },
      { externalId: 'b' },
    ])
    mocks.readLastSyncAt.mockResolvedValue('2026-07-21T00:00:00.000Z')
    // order matches providers.map(name) + 'embedding': kalshi degraded, rest ok.
    mocks.mget.mockResolvedValue(['1', null, null])

    const res = await GET()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        lastSyncAt: '2026-07-21T00:00:00.000Z',
        catalogSize: 2,
        degraded: ['kalshi'],
      },
    })
  })

  // AC 19: pre-first-sync (Redis never populated) → 200, not 500.
  it('returns 200 with lastSyncAt: null, catalogSize: 0, degraded: [] pre-first-sync', async () => {
    mocks.readHotCatalog.mockResolvedValue([])
    mocks.readLastSyncAt.mockResolvedValue(null)
    mocks.mget.mockResolvedValue([null, null, null])

    const res = await GET()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: { lastSyncAt: null, catalogSize: 0, degraded: [] },
    })
  })

  // AC 20: fast, Redis-only — never calls a provider or touches Postgres.
  it('never calls a provider.fetchOpenMarkets', async () => {
    mocks.readHotCatalog.mockResolvedValue([])
    mocks.readLastSyncAt.mockResolvedValue(null)
    mocks.mget.mockResolvedValue([null, null, null])

    await GET()

    expect(mocks.kalshiFetch).not.toHaveBeenCalled()
    expect(mocks.polyFetch).not.toHaveBeenCalled()
  })

  it('never imports "@/server/db" (statically grep-checkable, matches AC 20)', () => {
    const routePath = fileURLToPath(new URL('./route.ts', import.meta.url))
    const source = readFileSync(routePath, 'utf-8')
    expect(source).not.toMatch(/@\/server\/db/)
  })
})
