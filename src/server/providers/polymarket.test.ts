import { describe, expect, it } from 'vitest'
import { SchemaMismatchError } from '@/server/http'
import { normalizePolymarketMarkets } from './polymarket'
import polymarketFixture from './fixtures/polymarket.json'

describe('normalizePolymarketMarkets', () => {
  const markets = normalizePolymarketMarkets(polymarketFixture)

  it('keeps only open, binary markets (skips 3-way and closed)', () => {
    expect(markets).toHaveLength(1)
    expect(markets[0]?.externalId).toBe('0x1')
  })

  it('parses the JSON-encoded outcome prices to 0–1', () => {
    expect(markets[0]?.yesPrice).toBeCloseTo(0.31, 4)
    expect(markets[0]?.noPrice).toBeCloseTo(0.69, 4)
  })

  it('coerces money strings to numbers', () => {
    expect(markets[0]?.volumeUsd).toBe(250000)
    expect(markets[0]?.liquidityUsd).toBe(40000)
  })

  it('deep-links via slug', () => {
    expect(markets[0]?.url).toContain('btc-below-60k')
    expect(markets[0]?.provider).toBe('polymarket')
  })

  it('throws SchemaMismatchError on an unexpected payload', () => {
    expect(() => normalizePolymarketMarkets({ nope: true })).toThrow(
      SchemaMismatchError
    )
  })
})
