import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Route tests for `GET /api/cron/sync` (spec `docs/features/hardening/spec.md`
 * AC 6, 15). `@/server/sync` and `@/server/log` are mocked so no
 * provider/Postgres/Redis call is ever made from this suite, following the
 * `hedge/route.test.ts` `vi.hoisted` + `vi.mock` idiom. `@/config/env` is
 * mocked (same pattern as `retrieve.test.ts`) so the real module's
 * `import 'server-only'` + `process.env` validation never runs.
 */

const mocks = vi.hoisted(() => ({
  runSync: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@/config/env', () => ({
  env: { CRON_SECRET: 'test-cron-secret' },
}))

vi.mock('@/server/sync', () => ({ runSync: mocks.runSync }))

vi.mock('@/server/log', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mocks.loggerError,
  },
  newErrorId: () => 'test-err-id',
}))

import { GET } from './route'

function req(authorization?: string): NextRequest {
  return new NextRequest('http://localhost/api/cron/sync', {
    method: 'GET',
    headers: authorization !== undefined ? { authorization } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── auth guard — the ONLY protection on this route (AC 6) ──────────────────
describe('GET /api/cron/sync — Bearer auth', () => {
  it('missing Authorization header → 401 UNAUTHORIZED, runSync never called', async () => {
    const res = await GET(req())

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret' },
    })
    expect(mocks.runSync).not.toHaveBeenCalled()
  })

  it('wrong bearer secret → 401 UNAUTHORIZED, runSync never called', async () => {
    const res = await GET(req('Bearer wrong-secret'))

    expect(res.status).toBe(401)
    expect(mocks.runSync).not.toHaveBeenCalled()
  })

  it('correct bearer secret → runs sync, returns 200 ok(result)', async () => {
    mocks.runSync.mockResolvedValue({
      fetched: 5,
      upserted: 5,
      embedded: 2,
      degraded: [],
    })

    const res = await GET(req('Bearer test-cron-secret'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: { fetched: 5, upserted: 5, embedded: 2, degraded: [] },
    })
  })
})

// ── hardening AC 15 — structured error logging on a forced 500 ─────────────
describe('GET /api/cron/sync — 500 on runSync failure', () => {
  it('runSync rejects → 500 SYNC_FAILED with the error message, logger.error called with an errorId', async () => {
    mocks.runSync.mockRejectedValue(new Error('sync exploded'))

    const res = await GET(req('Bearer test-cron-secret'))

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: { code: 'SYNC_FAILED', message: 'sync exploded' },
    })
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'GET /api/cron/sync failed',
      expect.objectContaining({
        route: 'GET /api/cron/sync',
        errorId: 'test-err-id',
        err: 'sync exploded',
      })
    )
  })

  it('a non-Error throw still maps to 500 SYNC_FAILED with a generic message', async () => {
    mocks.runSync.mockRejectedValue('not an Error instance')

    const res = await GET(req('Bearer test-cron-secret'))

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: { code: 'SYNC_FAILED', message: 'sync failed' },
    })
  })
})

// ── hardening AC 6 — no rate limiter added here ─────────────────────────────
describe('GET /api/cron/sync — no rate limiter (AC 6)', () => {
  it('the route source never imports "@/server/rate-limit" or calls checkRateLimit', () => {
    const routePath = fileURLToPath(new URL('./route.ts', import.meta.url))
    const source = readFileSync(routePath, 'utf-8')
    expect(source).not.toMatch(/@\/server\/rate-limit/)
    expect(source).not.toMatch(/checkRateLimit/)
  })
})
