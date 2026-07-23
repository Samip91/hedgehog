import { describe, expect, it } from 'vitest'
import {
  NOT_SPECIFIED,
  NO_DEADLINE,
  formatDate,
  formatDeadline,
  formatExposureUsd,
  formatPrice,
  formatUsd,
} from './format'

describe('formatUsd', () => {
  it('formats zero', () => {
    expect(formatUsd(0)).toBe('$0.00')
  })

  it('formats a whole number', () => {
    expect(formatUsd(500)).toBe('$500.00')
  })

  it('formats decimals, rounded to 2 places', () => {
    expect(formatUsd(120.5)).toBe('$120.50')
    expect(formatUsd(99.995)).toBe('$100.00')
  })

  it('formats thousands with a separator', () => {
    expect(formatUsd(1234.5)).toBe('$1,234.50')
  })
})

describe('formatExposureUsd — null copy (AC 5)', () => {
  it('null → "not specified"', () => {
    expect(formatExposureUsd(null)).toBe(NOT_SPECIFIED)
  })

  it('a number → currency', () => {
    expect(formatExposureUsd(500)).toBe('$500.00')
  })
})

describe('formatPrice', () => {
  it('0.24 → "24¢"', () => {
    expect(formatPrice(0.24)).toBe('24¢')
  })

  it('rounds to the nearest cent', () => {
    expect(formatPrice(0.245)).toBe('25¢')
    expect(formatPrice(0.244)).toBe('24¢')
  })

  it('handles small and large prices within (0,1)', () => {
    expect(formatPrice(0.01)).toBe('1¢')
    expect(formatPrice(0.99)).toBe('99¢')
  })
})

describe('formatDate', () => {
  it('formats a YYYY-MM-DD deadline as a UTC calendar date (no off-by-one)', () => {
    expect(formatDate('2026-03-21')).toBe('Mar 21, 2026')
  })

  it('formats an ISO closeTime date-time', () => {
    expect(formatDate('2026-03-21T18:30:00Z')).toBe('Mar 21, 2026')
  })

  it('returns the raw value unchanged for an unparseable date', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date')
  })
})

describe('formatDeadline — null copy (AC 5)', () => {
  it('null → "no deadline"', () => {
    expect(formatDeadline(null)).toBe(NO_DEADLINE)
  })

  it('a YYYY-MM-DD value → formatted date', () => {
    expect(formatDeadline('2026-03-21')).toBe('Mar 21, 2026')
  })
})
