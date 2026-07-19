/**
 * Eval runner (spec §6.7).
 *
 * Offline by default: parse evals replay recorded model responses and retrieval
 * evals run against the frozen fixture catalog — deterministic, zero API cost,
 * safe for CI. `pnpm evals:live` (EVALS_LIVE=1) runs against live APIs locally.
 *
 * Current state: the pipeline (parse/retrieve/rank) lands via the /feature
 * workflow. Until then this runner validates the eval *fixtures* are well-formed
 * and prints the staged case table, so CI stays green and the harness is ready
 * to wire. Thresholds (parse ≥ 0.85, recall@15 ≥ 0.85) are enforced here once
 * the pipeline is implemented — see the TODOs below.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const live = Boolean(process.env.EVALS_LIVE)

interface ParseCase {
  id: string
  prompt: string
  expect: Record<string, unknown>
}
interface RetrievalCase {
  id: string
  prompt: string
  expectedMarketIds: string[]
}

function load<T>(file: string): T {
  return JSON.parse(readFileSync(join(here, file), 'utf8')) as T
}

function main(): number {
  const parseCases = load<ParseCase[]>('cases.json')
  const retrievalCases = load<RetrievalCase[]>('retrieval-cases.json')
  const catalog = load<unknown[]>('fixtures/catalog.json')

  console.log(`\nHedgehog evals — mode: ${live ? 'LIVE' : 'offline (fixtures)'}\n`)
  console.log(`Fixture catalog: ${catalog.length} markets`)

  // Structural validation keeps the fixtures honest before the pipeline exists.
  let bad = 0
  for (const c of parseCases) {
    const okShape = c.id && c.prompt && typeof c.expect === 'object'
    if (!okShape) bad++
    console.log(`  parse   ${okShape ? '·' : '✗'}  ${c.id}`)
  }
  for (const c of retrievalCases) {
    const okShape = c.id && c.prompt && Array.isArray(c.expectedMarketIds)
    if (!okShape) bad++
    console.log(`  retrieve${okShape ? '·' : '✗'}  ${c.id}`)
  }

  console.log(
    `\n${parseCases.length} parse cases, ${retrievalCases.length} retrieval cases staged.`
  )

  // TODO(feature: parse):    run parseRisk() and assert fields → parsePassRate ≥ 0.85
  // TODO(feature: retrieval): run retrieveCandidates() on the fixture catalog
  //                           → recall@15 ≥ 0.85, report MRR
  console.log(
    'Pipeline not yet wired — metric gates activate with feature: parse / retrieval.\n'
  )

  return bad === 0 ? 0 : 1
}

process.exit(main())
