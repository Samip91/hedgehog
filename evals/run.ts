/**
 * Eval runner (spec §6.7).
 *
 * Offline by default: parse evals replay recorded model responses and retrieval
 * evals run against the frozen fixture catalog — deterministic, zero API cost,
 * safe for CI. `pnpm evals:live` (EVALS_LIVE=1) runs against live APIs locally
 * and refreshes `fixtures/parse-responses.json` (ADR 002).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import {
  parseRisk,
  chatComplete,
  type ChatFn,
  type ChatMessage,
} from '@/server/pipeline/parse'
import {
  retrieveCandidates,
  type RetrieveDeps,
  type ScoredMarket,
} from '@/server/pipeline/retrieve'
import { buildNormalizedMarket } from '@/server/providers/normalize'
import type { NormalizedMarket } from '@/server/providers/types'
import type { HedgeSpec } from '@/shared/schemas'
import { cosineSim, toyEmbed } from './lib/toy-embed'

const here = dirname(fileURLToPath(import.meta.url))
const live = Boolean(process.env.EVALS_LIVE)

const PARSE_PASS_THRESHOLD = 0.85
const RETRIEVAL_PASS_THRESHOLD = 0.85

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

/** Validated at the fixture-load boundary (Zod), mirrors `NormalizedMarket`.
 * `fixtures/catalog.json` carries no embedding vectors (ADR 003) — offline
 * cosine derives from the deterministic `toyEmbed` at eval time instead. */
const CatalogMarketSchema = z.object({
  provider: z.enum(['kalshi', 'polymarket']),
  externalId: z.string().min(1),
  question: z.string().min(1),
  eventTitle: z.string().optional(),
  searchText: z.string().min(1),
  category: z.string().optional(),
  yesPrice: z.number(),
  noPrice: z.number(),
  volumeUsd: z.number().optional(),
  liquidityUsd: z.number().optional(),
  closeTime: z.coerce.date().optional(),
  status: z.enum(['open', 'closed', 'resolved']),
  resolvedYes: z.boolean().optional(),
  url: z.string().min(1),
})

function loadCatalog(): NormalizedMarket[] {
  const raw = load<unknown[]>('fixtures/catalog.json')
  return raw.map((entry, i) => {
    const parsed = CatalogMarketSchema.safeParse(entry)
    if (!parsed.success) {
      throw new Error(
        `fixtures/catalog.json[${i}] failed validation: ${parsed.error.message}`
      )
    }
    const m = parsed.data
    // `exactOptionalPropertyTypes` — omit undefined optionals rather than
    // assigning them (mirrors `buildNormalizedMarket`'s own contract).
    return buildNormalizedMarket(
      {
        provider: m.provider,
        externalId: m.externalId,
        question: m.question,
        searchText: m.searchText,
        yesPrice: m.yesPrice,
        noPrice: m.noPrice,
        status: m.status,
        url: m.url,
      },
      {
        eventTitle: m.eventTitle,
        category: m.category,
        volumeUsd: m.volumeUsd,
        liquidityUsd: m.liquidityUsd,
        closeTime: m.closeTime,
        resolvedYes: m.resolvedYes,
      }
    )
  })
}

/** Retrieval cases carry no `HedgeSpec` — synthesize a permissive minimal
 * one so only status + liquidity-floor hard filters bite and recall is
 * ranking-driven (ADR 003 decision 3; domain/confidence/closeTime filter
 * behavior is covered by `retrieve.test.ts` instead). */
function specForCase(prompt: string): HedgeSpec {
  return {
    riskDescription: prompt,
    domain: 'other',
    direction: 'happens',
    exposureUsd: null,
    deadline: null,
    location: null,
    asset: null,
    threshold: null,
    confidence: 'low',
    clarificationNeeded: null,
  }
}

/** Offline `RetrieveDeps`: no NIM, no Postgres — `embed`/`vectorTopK` derive
 * both query and market vectors from `searchText` via the deterministic
 * `toyEmbed`; `keywordPool` is just the in-memory fixture catalog. */
function buildOfflineDeps(catalog: NormalizedMarket[]): RetrieveDeps {
  return {
    embed: (text: string) => Promise.resolve(toyEmbed(text)),
    vectorTopK: (q: number[], k: number): Promise<ScoredMarket[]> => {
      const scored = catalog
        .map(market => ({
          market,
          cosine: cosineSim(q, toyEmbed(market.searchText)),
        }))
        .sort((a, b) => b.cosine - a.cosine)
        .slice(0, k)
      return Promise.resolve(scored)
    },
    keywordPool: () => Promise.resolve(catalog),
  }
}

async function runRetrievalCases(
  retrievalCases: RetrievalCase[],
  catalog: NormalizedMarket[]
): Promise<{ recall: number; mrr: number }> {
  const deps = buildOfflineDeps(catalog)
  let recallSum = 0
  let rrSum = 0

  for (const c of retrievalCases) {
    const candidates = await retrieveCandidates(
      specForCase(c.prompt),
      c.prompt,
      deps
    )
    const top = candidates.map(cand => cand.market.externalId)

    const hits = c.expectedMarketIds.filter(id => top.includes(id))
    const recall =
      c.expectedMarketIds.length === 0
        ? 1
        : hits.length / c.expectedMarketIds.length

    // MRR uses the MIN rank across all expected ids that hit (conventional
    // definition), not just the first id in `expectedMarketIds` list order —
    // matters once a case carries multiple expected ids.
    const ranks = c.expectedMarketIds
      .map(id => top.indexOf(id))
      .filter(idx => idx !== -1)
      .map(idx => idx + 1)
    const minRank = ranks.length > 0 ? Math.min(...ranks) : 0
    const rr = minRank > 0 ? 1 / minRank : 0

    recallSum += recall
    rrSum += rr

    const ok = recall === 1
    console.log(
      `  retrieve${ok ? '·' : '✗'}  ${c.id}  recall=${recall.toFixed(2)} rr=${rr.toFixed(2)}`
    )
  }

  return {
    recall: retrievalCases.length === 0 ? 1 : recallSum / retrievalCases.length,
    mrr: retrievalCases.length === 0 ? 0 : rrSum / retrievalCases.length,
  }
}

function load<T>(file: string): T {
  return JSON.parse(readFileSync(join(here, file), 'utf8')) as T
}

function getField(spec: HedgeSpec, field: string): unknown {
  return (spec as unknown as Record<string, unknown>)[field]
}

/**
 * `"*"` → non-null; `null` → strict null; number|boolean → strict `===`;
 * string → case-insensitive substring (spec AC 11 / AC 13).
 */
function matchField(actual: unknown, expected: unknown): boolean {
  if (expected === '*') return actual !== null && actual !== undefined
  if (expected === null) return actual === null
  if (typeof expected === 'number' || typeof expected === 'boolean') {
    return actual === expected
  }
  if (typeof expected === 'string') {
    return (
      typeof actual === 'string' &&
      actual.toLowerCase().includes(expected.toLowerCase())
    )
  }
  return actual === expected
}

/** Offline: replay the frozen fixture per case id, hard-erroring if absent. */
function offlineChatFor(
  caseId: string,
  fixtures: Record<string, string>
): ChatFn {
  return async () => {
    const content = fixtures[caseId]
    if (content === undefined) {
      throw new Error(
        `evals/fixtures/parse-responses.json is missing case "${caseId}" — run \`pnpm evals:live\` to refresh it.`
      )
    }
    return content
  }
}

/** Live: the real NIM client, recording the content it returns for this case. */
function liveChatFor(caseId: string, recorded: Record<string, string>): ChatFn {
  return async (messages: ChatMessage[]) => {
    const content = await chatComplete(messages)
    recorded[caseId] = content
    return content
  }
}

async function runParseCases(parseCases: ParseCase[]): Promise<number> {
  const fixtures = live
    ? {}
    : load<Record<string, string>>('fixtures/parse-responses.json')
  const recorded: Record<string, string> = {}

  let passed = 0
  for (const c of parseCases) {
    const chat = live
      ? liveChatFor(c.id, recorded)
      : offlineChatFor(c.id, fixtures)

    const result = await parseRisk(c.prompt, { chat })

    const mismatches = Object.entries(c.expect)
      .filter(
        ([field, expected]) => !matchField(getField(result, field), expected)
      )
      .map(([field]) => field)

    const ok = mismatches.length === 0
    if (ok) passed++
    console.log(
      `  parse   ${ok ? '·' : '✗'}  ${c.id}${ok ? '' : `  (mismatched: ${mismatches.join(', ')})`}`
    )
  }

  if (live) {
    writeFileSync(
      join(here, 'fixtures/parse-responses.json'),
      `${JSON.stringify(recorded, null, 2)}\n`
    )
    console.log(
      '\nRecorded live responses to evals/fixtures/parse-responses.json\n'
    )
  }

  return parseCases.length === 0 ? 1 : passed / parseCases.length
}

async function main(): Promise<number> {
  const parseCases = load<ParseCase[]>('cases.json')
  const retrievalCases = load<RetrievalCase[]>('retrieval-cases.json')
  const catalog = loadCatalog()

  console.log(
    `\nHedgehog evals — mode: ${live ? 'LIVE' : 'offline (fixtures)'}\n`
  )
  console.log(`Fixture catalog: ${catalog.length} markets`)

  let bad = 0

  const parsePassRate = await runParseCases(parseCases)
  console.log(
    `\nparsePassRate: ${(parsePassRate * 100).toFixed(1)}% (threshold ${(PARSE_PASS_THRESHOLD * 100).toFixed(0)}%)`
  )
  if (parsePassRate < PARSE_PASS_THRESHOLD) bad++

  const { recall, mrr } = await runRetrievalCases(retrievalCases, catalog)
  console.log(
    `\nretrievalRecall@15: ${(recall * 100).toFixed(1)}% (threshold ${(RETRIEVAL_PASS_THRESHOLD * 100).toFixed(0)}%)`
  )
  console.log(`retrievalMRR: ${mrr.toFixed(3)} (report-only, no gate)`)
  if (recall < RETRIEVAL_PASS_THRESHOLD) bad++

  console.log(
    `\n${parseCases.length} parse cases, ${retrievalCases.length} retrieval cases run.\n`
  )

  return bad === 0 ? 0 : 1
}

main().then(code => process.exit(code))
