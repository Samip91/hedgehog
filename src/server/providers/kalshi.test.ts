import { describe, expect, it } from 'vitest'
import { SchemaMismatchError } from '@/server/http'
import { normalizeKalshiMarkets } from './kalshi'
import kalshiFixture from './fixtures/kalshi.json'

describe('normalizeKalshiMarkets', () => {
  const markets = normalizeKalshiMarkets(kalshiFixture)

  it('drops markets with no usable price', () => {
    expect(markets).toHaveLength(2)
    expect(markets.map(m => m.externalId)).not.toContain('NO-PRICE')
  })

  it('uses the yes bid/ask midpoint as a 0–1 probability', () => {
    const rain = markets.find(m => m.externalId === 'RAIN-MIA-MAR21')
    expect(rain).toBeDefined()
    expect(rain?.yesPrice).toBeCloseTo(0.24, 4) // (22+26)/2 = 24¢
    expect(rain?.noPrice).toBeCloseTo(0.76, 4)
    expect(rain?.provider).toBe('kalshi')
    expect(rain?.status).toBe('open')
  })

  it('falls back to last_price when there is no bid/ask', () => {
    const btc = markets.find(m => m.externalId === 'BTC-BELOW-60K')
    expect(btc?.yesPrice).toBeCloseTo(0.31, 4)
  })

  it('builds searchText from event + title + subtitle + category', () => {
    const rain = markets.find(m => m.externalId === 'RAIN-MIA-MAR21')
    expect(rain?.searchText).toContain('Miami')
    expect(rain?.searchText).toContain('rain')
    expect(rain?.eventTitle).toBe('RAIN-MIA')
    expect(rain?.category).toBe('Weather')
  })

  it('throws SchemaMismatchError on an unexpected payload', () => {
    expect(() => normalizeKalshiMarkets({ nope: true })).toThrow(
      SchemaMismatchError
    )
  })
})
