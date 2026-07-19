import { describe, expect, it } from 'vitest'
import { fromProviderEnum, toProviderEnum } from './provider-enum'

describe('provider casing boundary', () => {
  it('maps normalized lowercase names to the Prisma enum', () => {
    expect(toProviderEnum('kalshi')).toBe('KALSHI')
    expect(toProviderEnum('polymarket')).toBe('POLYMARKET')
  })

  it('maps the Prisma enum back to normalized lowercase names', () => {
    expect(fromProviderEnum('KALSHI')).toBe('kalshi')
    expect(fromProviderEnum('POLYMARKET')).toBe('polymarket')
  })

  it('round-trips', () => {
    for (const name of ['kalshi', 'polymarket'] as const) {
      expect(fromProviderEnum(toProviderEnum(name))).toBe(name)
    }
  })
})
