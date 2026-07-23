import 'server-only'
import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'

/**
 * Anonymous identity cookie (ADR 007): a single httpOnly `anonId` — no
 * accounts/auth. `getAnonId()` only *reads* (Next 16 `cookies()` is async);
 * minting a fresh id happens only on `POST /api/hedges`, via `setAnonCookie`
 * on the response. Reads (`GET`) never mint (AC 3).
 */
export const ANON_COOKIE = 'anonId'

/** ~1 year, in seconds. */
export const ANON_MAX_AGE = 60 * 60 * 24 * 365

/** Read-only — never mints. Returns `null` when no cookie is present. */
export async function getAnonId(): Promise<string | null> {
  const store = await cookies()
  return store.get(ANON_COOKIE)?.value ?? null
}

/** Sets the httpOnly `anonId` cookie on a route response (POST only). */
export function setAnonCookie(res: NextResponse, id: string): void {
  res.cookies.set(ANON_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ANON_MAX_AGE,
  })
}
