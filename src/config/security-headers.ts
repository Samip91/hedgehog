/**
 * Pure security-header builder shared by `next.config.ts`'s `async headers()`.
 * No `next` import, no `process.env` — `isDev` is derived from the config
 * `phase` by the caller so this module stays a plain, unit-testable function.
 */

function buildCsp(isDev: boolean): string {
  const directives: string[] = [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline'${isDev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'${isDev ? ' ws:' : ''}`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ]
  return directives.join('; ')
}

export function securityHeaders(
  isDev: boolean
): { key: string; value: string }[] {
  return [
    {
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload',
    },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    {
      key: 'Permissions-Policy',
      value:
        'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    },
    { key: 'Content-Security-Policy', value: buildCsp(isDev) },
  ]
}
