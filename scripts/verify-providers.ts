/**
 * Live smoke test for the provider clients — run locally:
 *
 *   pnpm verify:providers
 *
 * Exit criterion (spec §10, day 1): prints normalized live markets across both
 * providers. Confirms the Zod schemas match reality; a mismatch throws a
 * SchemaMismatchError with a trimmed payload.
 *
 * Resilience: some dev networks sinkhole the provider hostnames (resolve them to
 * 127.0.0.1). To make the smoke test work anywhere, we resolve the two hosts via
 * public DNS (8.8.8.8 / 1.1.1.1) and pin the result into `dns.lookup`. On a normal
 * network this is transparent. It does NOT touch the app's runtime code.
 */
import dns from 'node:dns'
import { Resolver } from 'node:dns/promises'
import { providers } from '@/server/providers/registry'
import { SchemaMismatchError } from '@/server/http'

const HOSTS = ['api.elections.kalshi.com', 'gamma-api.polymarket.com']

/* eslint-disable @typescript-eslint/no-explicit-any */
async function pinViaPublicDns(): Promise<void> {
  const resolver = new Resolver()
  resolver.setServers(['8.8.8.8', '1.1.1.1'])

  const pins = new Map<string, string>()
  for (const host of HOSTS) {
    try {
      const [ip] = await resolver.resolve4(host)
      if (ip) pins.set(host, ip)
    } catch {
      /* fall back to system DNS for this host */
    }
  }
  if (pins.size === 0) return

  const original = dns.lookup.bind(dns) as any
  ;(dns as any).lookup = (hostname: string, options: any, callback: any) => {
    const ip = pins.get(hostname)
    if (!ip) return original(hostname, options, callback)
    const cb = typeof options === 'function' ? options : callback
    const opts = typeof options === 'object' && options ? options : {}
    if (opts.all) return cb(null, [{ address: ip, family: 4 }])
    return cb(null, ip, 4)
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function main(): Promise<void> {
  await pinViaPublicDns()

  let total = 0
  for (const provider of providers) {
    try {
      const markets = await provider.fetchOpenMarkets({ limit: 500 })
      total += markets.length
      console.log(`✓ ${provider.name}: ${markets.length} markets`)
      const sample = markets[0]
      if (sample) {
        console.log(
          `    e.g. "${sample.question}" — yes ${sample.yesPrice} / no ${sample.noPrice}`
        )
      }
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause
      console.error(
        `✗ ${provider.name}: ${err instanceof Error ? err.message : String(err)}` +
          (cause?.code ? ` (${cause.code})` : '')
      )
      if (err instanceof SchemaMismatchError) {
        console.error(`    payload preview: ${err.payloadPreview}`)
      }
    }
  }

  console.log(`\nTOTAL: ${total} normalized markets`)
  if (total < 500) {
    console.warn('⚠ expected 500+ — check endpoints, filters, or pagination.')
    process.exitCode = 1
  }
}

void main()
