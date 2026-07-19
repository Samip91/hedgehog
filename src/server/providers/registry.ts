import { kalshiProvider } from './kalshi'
import { polymarketProvider } from './polymarket'
import type { MarketProvider } from './types'

/** All providers the sync loop pulls from. Add new providers here only. */
export const providers: readonly MarketProvider[] = [
  kalshiProvider,
  polymarketProvider,
]

export function getProvider(name: string): MarketProvider | undefined {
  return providers.find(p => p.name === name)
}
