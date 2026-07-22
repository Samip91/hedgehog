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
import {
  parseRisk,
  chatComplete,
  type ChatFn,
  type ChatMessage,
} from '@/server/pipeline/parse'
import type { HedgeSpec } from '@/shared/schemas'

const here = dirname(fileURLToPath(import.meta.url))
const live = Boolean(process.env.EVALS_LIVE)

const PARSE_PASS_THRESHOLD = 0.85

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
  const catalog = load<unknown[]>('fixtures/catalog.json')

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

  // Retrieval fixture validation stays structural until feature: retrieval lands.
  for (const c of retrievalCases) {
    const okShape = c.id && c.prompt && Array.isArray(c.expectedMarketIds)
    if (!okShape) bad++
    console.log(`  retrieve${okShape ? '·' : '✗'}  ${c.id}`)
  }

  console.log(
    `\n${parseCases.length} parse cases, ${retrievalCases.length} retrieval cases staged.`
  )

  // TODO(feature: retrieval): run retrieveCandidates() on the fixture catalog
  //                           → recall@15 ≥ 0.85, report MRR
  console.log(
    'Retrieval pipeline not yet wired — recall@15/MRR gate activates with feature: retrieval.\n'
  )

  return bad === 0 ? 0 : 1
}

main().then(code => process.exit(code))
