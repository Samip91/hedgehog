import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { securityHeaders } from './security-headers'

/**
 * Unit tests for `securityHeaders` (spec `docs/features/hardening/spec.md`
 * AC 10–13). Pure module, no `next` import — asserted statically below so it
 * stays importable/testable from a plain `node` environment and from
 * `next.config.ts`'s `headers()` alike.
 */

function findHeader(
  headers: { key: string; value: string }[],
  key: string
): string | undefined {
  return headers.find(h => h.key === key)?.value
}

describe('securityHeaders(false) — required headers present with exact values (AC 10)', () => {
  const headers = securityHeaders(false)

  it('Strict-Transport-Security', () => {
    expect(findHeader(headers, 'Strict-Transport-Security')).toBe(
      'max-age=63072000; includeSubDomains; preload'
    )
  })

  it('X-Content-Type-Options: nosniff', () => {
    expect(findHeader(headers, 'X-Content-Type-Options')).toBe('nosniff')
  })

  it('Referrer-Policy', () => {
    expect(findHeader(headers, 'Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin'
    )
  })

  it('X-Frame-Options: DENY (frame-block)', () => {
    expect(findHeader(headers, 'X-Frame-Options')).toBe('DENY')
  })

  it('Permissions-Policy', () => {
    expect(findHeader(headers, 'Permissions-Policy')).toBe(
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()'
    )
  })

  it('a Content-Security-Policy header is present', () => {
    expect(findHeader(headers, 'Content-Security-Policy')).toBeDefined()
  })
})

describe('securityHeaders(false) — CSP directive content (AC 11, 12)', () => {
  const csp =
    findHeader(securityHeaders(false), 'Content-Security-Policy') ?? ''

  it.each([
    `default-src 'self'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `style-src 'self' 'unsafe-inline'`,
    `script-src 'self' 'unsafe-inline'`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
  ])('contains directive: %s', directive => {
    expect(csp).toContain(directive)
  })

  it('does not allow an arbitrary third-party script (no script-src *)', () => {
    expect(csp).not.toMatch(/script-src[^;]*\*/)
  })

  it('scripts are at minimum restricted to self', () => {
    expect(csp).toMatch(/script-src 'self'/)
  })
})

describe('securityHeaders — dev vs prod CSP differences (AC 10-12)', () => {
  it("isDev=true adds 'unsafe-eval' to script-src", () => {
    const csp =
      findHeader(securityHeaders(true), 'Content-Security-Policy') ?? ''
    expect(csp).toContain(`script-src 'self' 'unsafe-inline' 'unsafe-eval'`)
  })

  it('isDev=true adds ws: to connect-src', () => {
    const csp =
      findHeader(securityHeaders(true), 'Content-Security-Policy') ?? ''
    expect(csp).toContain(`connect-src 'self' ws:`)
  })

  it("isDev=false does NOT add 'unsafe-eval'", () => {
    const csp =
      findHeader(securityHeaders(false), 'Content-Security-Policy') ?? ''
    expect(csp).not.toContain('unsafe-eval')
  })

  it('isDev=false does NOT add ws: to connect-src', () => {
    const csp =
      findHeader(securityHeaders(false), 'Content-Security-Policy') ?? ''
    expect(csp).not.toContain('ws:')
    expect(csp).toContain(`connect-src 'self'`)
  })
})

describe('securityHeaders — headers apply uniformly, no per-route opt-out (AC 13)', () => {
  it('returns the same header set (same keys) for every call — a pure function of isDev only', () => {
    const a = securityHeaders(false)
    const b = securityHeaders(false)

    expect(a.map(h => h.key)).toEqual(b.map(h => h.key))
    expect(a).toEqual(b)
  })
})

describe('security-headers.ts — pure module, no next import (AC 10 design constraint)', () => {
  it('the module source never imports "next" or "next/server"', () => {
    const modulePath = fileURLToPath(
      new URL('./security-headers.ts', import.meta.url)
    )
    const source = readFileSync(modulePath, 'utf-8')
    expect(source).not.toMatch(/from ['"]next(\/|['"])/)
    // `process.env.SOMETHING` (an actual read), not the doc comment's prose
    // mention of "process.env" as a design constraint.
    expect(source).not.toMatch(/process\.env\.\w/)
  })
})
