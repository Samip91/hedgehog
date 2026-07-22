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
  type Candidate,
  type RetrieveDeps,
  type ScoredMarket,
} from '@/server/pipeline/retrieve'
import { rerank, type RankedMatch } from '@/server/pipeline/rank'
import { chatComplete as sharedChatComplete } from '@/server/pipeline/nim-chat'
import { buildNormalizedMarket } from '@/server/providers/normalize'
import type { NormalizedMarket } from '@/server/providers/types'
import { HedgeSpecSchema, type HedgeSpec } from '@/shared/schemas'
import { env } from '@/config/env'
import { cosineSim, toyEmbed } from './lib/toy-embed'

const here = dirname(fileURLToPath(import.meta.url))
const live = Boolean(process.env.EVALS_LIVE)

const PARSE_PASS_THRESHOLD = 0.85
const RETRIEVAL_PASS_THRESHOLD = 0.85
const RERANK_PASS_THRESHOLD = 0.85

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

/** Self-contained rerank cases carry their own `spec` + inline `candidates`
 * (plan Q4) so the frozen retrieval `fixtures/catalog.json` stays untouched. */
const RerankCaseCandidateSchema = z.object({
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

const RerankExpectSchema = z.union([
  z.object({ empty: z.literal(true) }),
  z.object({
    matches: z.array(
      z.object({
        externalId: z.string().min(1),
        side: z.enum(['YES', 'NO']),
        relevance: z.enum(['high', 'partial', 'weak']),
      })
    ),
  }),
])

const RerankCaseSchema = z.object({
  id: z.string().min(1),
  spec: HedgeSpecSchema,
  candidates: z.array(RerankCaseCandidateSchema).min(1),
  expect: RerankExpectSchema,
})
type RerankCase = z.infer<typeof RerankCaseSchema>

function loadRerankCases(): RerankCase[] {
  const raw = load<unknown[]>('rerank-cases.json')
  return raw.map((entry, i) => {
    const parsed = RerankCaseSchema.safeParse(entry)
    if (!parsed.success) {
      throw new Error(
        `rerank-cases.json[${i}] failed validation: ${parsed.error.message}`
      )
    }
    return parsed.data
  })
}

/** Case candidate → in-memory `Candidate` (cosine/keyword/score: 0 — rerank
 * doesn't consult retrieval's score, only the model). */
function candidatesForCase(c: RerankCase): Candidate[] {
  return c.candidates.map(m => ({
    market: buildNormalizedMarket(
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
    ),
    cosine: 0,
    keyword: 0,
    score: 0,
  }))
}

/** Per Q4: `empty:true` passes iff `result.length === 0`; else the mapped
 * result must be length-exact and order-sensitive on `externalId`/`side`/
 * `relevance`, with every `reasoning` non-empty. */
function scoreRerankCase(
  expect: RerankCase['expect'],
  result: RankedMatch[]
): boolean {
  if ('empty' in expect) return result.length === 0
  if (result.length !== expect.matches.length) return false
  return expect.matches.every((expected, i) => {
    const actual = result[i]
    return (
      actual !== undefined &&
      actual.candidate.market.externalId === expected.externalId &&
      actual.side === expected.side &&
      actual.relevance === expected.relevance &&
      actual.reasoning.length > 0
    )
  })
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

/** Offline: replay the frozen rerank fixture per case id, hard-erroring if absent. */
function offlineRerankChatFor(
  caseId: string,
  fixtures: Record<string, string>
): ChatFn {
  return async () => {
    const content = fixtures[caseId]
    if (content === undefined) {
      throw new Error(
        `evals/fixtures/rerank-responses.json is missing case "${caseId}" — run \`pnpm evals:live\` to refresh it.`
      )
    }
    return content
  }
}

/** Live: the shared NIM client bound to `LLM_RERANK_MODEL`, recording the
 * content it returns for this case. */
function liveRerankChatFor(
  caseId: string,
  recorded: Record<string, string>
): ChatFn {
  return async (messages: ChatMessage[]) => {
    const content = await sharedChatComplete(messages, env.LLM_RERANK_MODEL)
    recorded[caseId] = content
    return content
  }
}

async function runRerankCases(rerankCases: RerankCase[]): Promise<number> {
  const fixtures = live
    ? {}
    : load<Record<string, string>>('fixtures/rerank-responses.json')
  const recorded: Record<string, string> = {}

  let passed = 0
  for (const c of rerankCases) {
    if (!live && fixtures[c.id] === undefined) {
      throw new Error(
        `rerank fixture missing for case "${c.id}" — run \`pnpm evals:live\` to record it.`
      )
    }

    const chat = live
      ? liveRerankChatFor(c.id, recorded)
      : offlineRerankChatFor(c.id, fixtures)

    const candidates = candidatesForCase(c)
    const result = await rerank(c.spec, candidates, { chat })

    const ok = scoreRerankCase(c.expect, result)
    if (ok) passed++
    console.log(`  rerank  ${ok ? '·' : '✗'}  ${c.id}`)
  }

  if (live) {
    writeFileSync(
      join(here, 'fixtures/rerank-responses.json'),
      `${JSON.stringify(recorded, null, 2)}\n`
    )
    console.log(
      '\nRecorded live responses to evals/fixtures/rerank-responses.json\n'
    )
  }

  return rerankCases.length === 0 ? 1 : passed / rerankCases.length
}

async function main(): Promise<number> {
  const parseCases = load<ParseCase[]>('cases.json')
  const retrievalCases = load<RetrievalCase[]>('retrieval-cases.json')
  const rerankCases = loadRerankCases()
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

  const rerankPassRate = await runRerankCases(rerankCases)
  console.log(
    `\nrerankPassRate: ${(rerankPassRate * 100).toFixed(1)}% (threshold ${(RERANK_PASS_THRESHOLD * 100).toFixed(0)}%)`
  )
  if (rerankPassRate < RERANK_PASS_THRESHOLD) bad++

  console.log(
    `\n${parseCases.length} parse cases, ${retrievalCases.length} retrieval cases, ${rerankCases.length} rerank cases run.\n`
  )

  return bad === 0 ? 0 : 1
}

main().then(code => process.exit(code))
