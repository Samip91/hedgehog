import { describe, expect, it } from 'vitest'
import {
  buildSearchText,
  centsToProbability,
  clamp01,
  parseJsonStringArray,
  round4,
  toNumber,
} from './normalize'

describe('normalize helpers', () => {
  it('centsToProbability divides by 100 and clamps', () => {
    expect(centsToProbability(24)).toBeCloseTo(0.24, 6)
    expect(centsToProbability(0)).toBe(0)
    expect(centsToProbability(150)).toBe(1)
    expect(centsToProbability(-5)).toBe(0)
  })

  it('clamp01 and round4', () => {
    expect(clamp01(1.4)).toBe(1)
    expect(clamp01(-0.2)).toBe(0)
    expect(round4(0.123456)).toBe(0.1235)
  })

  it('buildSearchText joins non-empty parts and collapses whitespace', () => {
    expect(buildSearchText('a', null, undefined, '  b ', '')).toBe('a b')
  })

  it('parseJsonStringArray parses encoded arrays, null on malformed', () => {
    expect(parseJsonStringArray('["Yes","No"]')).toEqual(['Yes', 'No'])
    expect(parseJsonStringArray('[0.3, 0.7]')).toEqual(['0.3', '0.7'])
    expect(parseJsonStringArray('not json')).toBeNull()
    expect(parseJsonStringArray('{"a":1}')).toBeNull()
  })

  it('toNumber coerces strings/numbers, undefined on junk', () => {
    expect(toNumber('250000')).toBe(250000)
    expect(toNumber(42)).toBe(42)
    expect(toNumber(undefined)).toBeUndefined()
    expect(toNumber('abc')).toBeUndefined()
  })
})
