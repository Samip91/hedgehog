import type { Provider } from '@prisma/client'
import type { NormalizedMarket } from './types'

/**
 * Provider casing boundary (see docs/PITFALLS.md).
 *
 * `NormalizedMarket.provider` uses the lowercase names the provider clients
 * naturally emit ('kalshi'); the Prisma `Provider` enum and saved records use
 * uppercase ('KALSHI'). Convert EXACTLY here — never sprinkle `.toUpperCase()`
 * around the sync/save code.
 */
export function toProviderEnum(name: NormalizedMarket['provider']): Provider {
  return name.toUpperCase() as Provider
}

export function fromProviderEnum(
  provider: Provider
): NormalizedMarket['provider'] {
  return provider.toLowerCase() as NormalizedMarket['provider']
}
