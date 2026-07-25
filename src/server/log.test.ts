import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Unit tests for the structured JSON logger (spec
 * `docs/features/hardening/spec.md` AC 14, 15, 17). `server-only` is
 * neutralized and `@/config/env` is mocked with a mutable object so
 * `LOG_LEVEL` can be flipped per test without re-importing the module
 * (mirrors the `retrieve.test.ts` / `sync.test.ts` idiom).
 */

const mockEnv = vi.hoisted(
  () =>
    ({ LOG_LEVEL: 'debug' }) as {
      LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error'
    }
)

vi.mock('server-only', () => ({}))
vi.mock('@/config/env', () => ({ env: mockEnv }))

import { logger, newErrorId } from './log'

let writeSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  mockEnv.LOG_LEVEL = 'debug'
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  writeSpy.mockRestore()
})

function lastWrittenLine(): Record<string, unknown> {
  const call = writeSpy.mock.calls.at(-1) as [string] | undefined
  if (call === undefined)
    throw new Error('process.stdout.write was never called')
  return JSON.parse(call[0].trimEnd()) as Record<string, unknown>
}

// ── AC 14 — JSON shape ──────────────────────────────────────────────────────
describe('logger — emits structured JSON via process.stdout.write (AC 14)', () => {
  it('a single call to process.stdout.write per log call, one line, ending in \\n', () => {
    logger.info('hello')

    expect(writeSpy).toHaveBeenCalledTimes(1)
    const [line] = writeSpy.mock.calls[0] as [string]
    expect(line.endsWith('\n')).toBe(true)
    expect(line.trimEnd().split('\n')).toHaveLength(1)
  })

  it('the line is valid JSON with {level, msg, ts, ...fields}', () => {
    logger.info('hello', { foo: 'bar' })

    const parsed = lastWrittenLine()
    expect(parsed).toMatchObject({ level: 'info', msg: 'hello', foo: 'bar' })
    expect(typeof parsed.ts).toBe('string')
    expect(new Date(parsed.ts as string).toString()).not.toBe('Invalid Date')
  })

  it('never uses console.* (process.stdout.write is the only sink)', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    logger.warn('should not touch console')

    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('works with no fields object at all', () => {
    logger.error('bare message')

    const parsed = lastWrittenLine()
    expect(parsed).toMatchObject({ level: 'error', msg: 'bare message' })
  })
})

// ── AC 14 — level filtering ──────────────────────────────────────────────────
describe('logger — level filtering gated by LOG_LEVEL (AC 14)', () => {
  it('LOG_LEVEL=info suppresses debug', () => {
    mockEnv.LOG_LEVEL = 'info'

    logger.debug('should not appear')

    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('LOG_LEVEL=info allows info, warn, error', () => {
    mockEnv.LOG_LEVEL = 'info'

    logger.info('a')
    logger.warn('b')
    logger.error('c')

    expect(writeSpy).toHaveBeenCalledTimes(3)
  })

  it('LOG_LEVEL=warn suppresses debug AND info', () => {
    mockEnv.LOG_LEVEL = 'warn'

    logger.debug('nope')
    logger.info('nope either')

    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('LOG_LEVEL=warn allows warn and error', () => {
    mockEnv.LOG_LEVEL = 'warn'

    logger.warn('yes')
    logger.error('yes too')

    expect(writeSpy).toHaveBeenCalledTimes(2)
  })

  it('LOG_LEVEL=error only allows error', () => {
    mockEnv.LOG_LEVEL = 'error'

    logger.debug('no')
    logger.info('no')
    logger.warn('no')
    logger.error('yes')

    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect(lastWrittenLine().level).toBe('error')
  })

  it('LOG_LEVEL=debug allows everything', () => {
    mockEnv.LOG_LEVEL = 'debug'

    logger.debug('a')
    logger.info('b')
    logger.warn('c')
    logger.error('d')

    expect(writeSpy).toHaveBeenCalledTimes(4)
  })
})

// ── AC 17 — redaction (never anon-id/creds/full raw prompt) ─────────────────
describe('logger — redact() strips secrets and truncates prompt (AC 17)', () => {
  it('drops anonId, cookie, authorization, token, secret, apiKey, password', () => {
    logger.info('test', {
      anonId: 'anon-123',
      cookie: 'session=abc',
      authorization: 'Bearer xyz',
      token: 'tok-abc',
      secret: 'sh',
      apiKey: 'nvapi-xxx',
      password: 'hunter2',
      keep: 'yes',
    })

    const parsed = lastWrittenLine()
    expect(parsed).not.toHaveProperty('anonId')
    expect(parsed).not.toHaveProperty('cookie')
    expect(parsed).not.toHaveProperty('authorization')
    expect(parsed).not.toHaveProperty('token')
    expect(parsed).not.toHaveProperty('secret')
    expect(parsed).not.toHaveProperty('apiKey')
    expect(parsed).not.toHaveProperty('password')
    expect(parsed.keep).toBe('yes')
  })

  it('truncates a prompt longer than 100 chars to 100 chars + an ellipsis', () => {
    logger.info('test', { prompt: 'a'.repeat(200) })

    const parsed = lastWrittenLine()
    expect(parsed.prompt).toBe(`${'a'.repeat(100)}…`)
    expect((parsed.prompt as string).length).toBe(101)
  })

  it('leaves a prompt of 100 chars or fewer untouched', () => {
    const short = 'a short risk prompt'
    logger.info('test', { prompt: short })

    const parsed = lastWrittenLine()
    expect(parsed.prompt).toBe(short)
  })

  it('a call with no fields never leaks anything beyond level/msg/ts', () => {
    logger.info('plain')

    const parsed = lastWrittenLine()
    expect(Object.keys(parsed).sort()).toEqual(['level', 'msg', 'ts'])
  })
})

// ── AC 15 — error id ─────────────────────────────────────────────────────────
describe('newErrorId (AC 15)', () => {
  it('returns a short, non-empty string', () => {
    const id = newErrorId()

    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    expect(id.length).toBeLessThanOrEqual(12)
  })

  it('returns a different id on each call', () => {
    const a = newErrorId()
    const b = newErrorId()

    expect(a).not.toBe(b)
  })
})
