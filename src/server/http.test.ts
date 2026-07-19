import { describe, expect, it, vi } from 'vitest'
import { CircuitBreaker, fetchJson, HttpError } from './http'

const noSleep = async (): Promise<void> => {}
const noJitter = (): number => 0

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

describe('fetchJson', () => {
  it('returns parsed JSON on 200', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { hello: 'hi' }))
    const data = await fetchJson<{ hello: string }>('https://x', {
      fetchImpl,
      sleep: noSleep,
      random: noJitter,
    })
    expect(data).toEqual({ hello: 'hi' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('retries 5xx then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    const data = await fetchJson('https://x', {
      fetchImpl,
      retries: 2,
      sleep: noSleep,
      random: noJitter,
    })
    expect(data).toEqual({ ok: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not retry 404', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, {}))
    await expect(
      fetchJson('https://x', { fetchImpl, retries: 3, sleep: noSleep })
    ).rejects.toBeInstanceOf(HttpError)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('throws HttpError after exhausting retries on persistent 503', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, {}))
    await expect(
      fetchJson('https://x', {
        fetchImpl,
        retries: 2,
        sleep: noSleep,
        random: noJitter,
      })
    ).rejects.toBeInstanceOf(HttpError)
    expect(fetchImpl).toHaveBeenCalledTimes(3) // initial + 2 retries
  })

  it('honors Retry-After on 429', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'retry-after': '2' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    await fetchJson('https://x', {
      fetchImpl,
      retries: 1,
      sleep,
      random: noJitter,
    })
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('retries on network/abort error then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    const data = await fetchJson('https://x', {
      fetchImpl,
      retries: 1,
      sleep: noSleep,
      random: noJitter,
    })
    expect(data).toEqual({ ok: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('fails fast on a TLS/cert error (no retry)', async () => {
    const tlsErr = Object.assign(new TypeError('tls'), {
      cause: { code: 'CERT_HAS_EXPIRED' },
    })
    const fetchImpl = vi.fn().mockRejectedValue(tlsErr)
    await expect(
      fetchJson('https://x', { fetchImpl, retries: 3, sleep: noSleep })
    ).rejects.toBeTruthy()
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})

describe('CircuitBreaker', () => {
  const fail = (): Promise<never> => Promise.reject(new Error('boom'))

  it('opens after threshold consecutive failures and fast-fails', async () => {
    const cb = new CircuitBreaker('t', {
      threshold: 3,
      cooldownMs: 1000,
      now: () => 0,
    })
    for (let i = 0; i < 3; i++)
      await expect(cb.run(fail)).rejects.toThrow('boom')
    expect(cb.state).toBe('open')
    await expect(cb.run(fail)).rejects.toThrow(/is open/)
  })

  it('half-opens after cooldown and closes on a successful probe', async () => {
    let t = 0
    const cb = new CircuitBreaker('t', {
      threshold: 2,
      cooldownMs: 1000,
      now: () => t,
    })
    await expect(cb.run(fail)).rejects.toThrow()
    await expect(cb.run(fail)).rejects.toThrow()
    expect(cb.state).toBe('open')
    t = 1000
    expect(cb.state).toBe('half-open')
    await cb.run(() => Promise.resolve('ok'))
    expect(cb.state).toBe('closed')
  })

  it('re-opens if the half-open probe fails', async () => {
    let t = 0
    const cb = new CircuitBreaker('t', {
      threshold: 1,
      cooldownMs: 1000,
      now: () => t,
    })
    await expect(cb.run(fail)).rejects.toThrow()
    expect(cb.state).toBe('open')
    t = 1000
    expect(cb.state).toBe('half-open')
    await expect(cb.run(fail)).rejects.toThrow()
    expect(cb.state).toBe('open')
  })

  it('resets the failure count on success', async () => {
    const cb = new CircuitBreaker('t', { threshold: 3, now: () => 0 })
    await expect(cb.run(fail)).rejects.toThrow()
    await expect(cb.run(fail)).rejects.toThrow()
    await cb.run(() => Promise.resolve(1))
    await expect(cb.run(fail)).rejects.toThrow()
    await expect(cb.run(fail)).rejects.toThrow()
    expect(cb.state).toBe('closed') // 2 fails < threshold after reset
  })
})
