/**
 * Live smoke test for the provider clients — run locally (needs open network):
 *
 *   pnpm tsx scripts/verify-providers.ts
 *
 * Exit criterion (spec §10, day 1): prints 500+ normalized live markets across
 * both providers. Confirms the Zod schemas match reality; a mismatch throws a
 * SchemaMismatchError with a trimmed payload.
 */
import { providers } from '@/server/providers/registry'

async function main(): Promise<void> {
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
      console.error(
        `✗ ${provider.name}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  console.log(`\nTOTAL: ${total} normalized markets`)
  if (total < 500) {
    console.warn('⚠ expected 500+ — check endpoints, filters, or schema drift.')
    process.exitCode = 1
  }
}

void main()
