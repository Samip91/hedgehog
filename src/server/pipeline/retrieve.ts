import { Prisma, Provider, MarketStatus } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/server/db'
import { embedText } from '@/server/pipeline/embed'
import {
  buildNormalizedMarket,
  buildSearchText,
} from '@/server/providers/normalize'
import { fromProviderEnum } from '@/server/providers/provider-enum'
import type { NormalizedMarket } from '@/server/providers/types'
import type { HedgeSpec } from '@/shared/schemas'

/**
 * Stage 2 — hybrid retrieval (spec §6.3):
 *   0.60·cosine + 0.25·keyword + 0.15·liquidityBoost, after hard filters
 *   (status, closeTime within deadline+30d, liquidity floor, domain when
 *   parse confidence is high), then cross-provider dedupe, top 15.
 *
 * pgvector HNSW cosine top-50 runs through a typed $queryRaw wrapper here
 * (Prisma has no native vector type). Degraded mode (embedding API down):
 * skip the cosine query entirely and fall back to a bounded keyword-only
 * pool read from Postgres (see ADR 003 for the DI-seam/offline-eval story).
 */
export interface Candidate {
  readonly market: NormalizedMarket
  readonly cosine: number
  readonly keyword: number
  readonly score: number
}

/** A market paired with its (already-computed) cosine similarity — `0` in
 * degraded (keyword-only) mode. */
export interface ScoredMarket {
  readonly market: NormalizedMarket
  readonly cosine: number
}

/** Injectable seams (mirrors `parseRisk(prompt, { chat })`, ADR 002). Defaults
 * touch NIM (`embedText`) and Postgres (`pgvectorTopK`/`loadOpenMarketPool`);
 * offline evals + unit tests inject in-process substitutes (ADR 003). */
export interface RetrieveDeps {
  readonly embed?: (text: string) => Promise<number[]>
  readonly vectorTopK?: (q: number[], k: number) => Promise<ScoredMarket[]>
  readonly keywordPool?: () => Promise<NormalizedMarket[]>
}

// ── Module constants (config knobs — see ADR 003 decision 4) ───────────────
export const VECTOR_TOP_K = 50
export const MAX_CANDIDATES = 15
export const WEIGHT_COSINE = 0.6
export const WEIGHT_KEYWORD = 0.25
export const WEIGHT_LIQUIDITY = 0.15
export const LIQUIDITY_FLOOR_USD = 1_000
export const LIQUIDITY_FULL_BOOST_USD = 500_000
export const DEADLINE_WINDOW_DAYS = 30
export const DEGRADED_POOL_SIZE = 200

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Cross-provider dedupe stopwords — small, intentionally conservative
 * (see plan decision 6): numeric tokens are kept, so "below 60000" ≠ "below
 * 70000" stays distinct. */
const DEDUPE_STOPWORDS = new Set([
  'will',
  'the',
  'a',
  'an',
  'in',
  'on',
  'of',
  'to',
  'this',
  'be',
  'is',
  'at',
  'by',
])

/** `tokenize(s) = new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(t => t.length >= 2))`
 * — shared by keyword scoring and dedupe signatures. */
function tokenize(s: string): Set<string> {
  const matches = s.toLowerCase().match(/[a-z0-9]+/g) ?? []
  return new Set(matches.filter(t => t.length >= 2))
}

// ── Hard filters (AC 5–8) ────────────────────────────────────────────────

/** Applied identically in both normal and degraded (keyword-only) modes
 * (AC 16). */
export function passesHardFilters(
  market: NormalizedMarket,
  spec: HedgeSpec
): boolean {
  if (market.status !== 'open') return false

  if (spec.deadline !== null) {
    if (market.closeTime === undefined) return false
    const deadlineMs = new Date(`${spec.deadline}T00:00:00.000Z`).getTime()
    const windowEndMs = deadlineMs + DEADLINE_WINDOW_DAYS * MS_PER_DAY
    if (market.closeTime.getTime() > windowEndMs) return false
  }

  if (
    market.liquidityUsd !== undefined &&
    market.liquidityUsd < LIQUIDITY_FLOOR_USD
  ) {
    return false
  }

  if (spec.confidence === 'high' && market.category !== spec.domain) {
    return false
  }

  return true
}

// ── Hybrid scoring (AC 9, 10) ────────────────────────────────────────────

/** Token coverage of the query by the market (in [0,1]) — coverage, not
 * Jaccard, so a verbose market isn't penalized (plan decision 4). Uses
 * `rawPrompt` too so literal user terms the normalized restatement dropped
 * still count. Empty query token set → `0`, never `NaN`. */
export function keywordScore(
  market: NormalizedMarket,
  spec: HedgeSpec,
  rawPrompt: string
): number {
  const queryText = buildSearchText(
    spec.riskDescription,
    spec.location,
    spec.asset,
    spec.threshold,
    rawPrompt
  )
  const queryTokens = tokenize(queryText)
  if (queryTokens.size === 0) return 0

  const marketTokens = tokenize(market.searchText)
  let overlap = 0
  for (const token of queryTokens) {
    if (marketTokens.has(token)) overlap++
  }
  return overlap / queryTokens.size
}

/** Missing `liquidityUsd` → `0`, never `NaN`/`undefined` (AC 9). Takes the
 * raw value (not a whole market) so it's directly testable in isolation. */
export function liquidityBoost(liquidityUsd: number | undefined): number {
  if (liquidityUsd === undefined) return 0
  return Math.min(1, Math.max(0, liquidityUsd / LIQUIDITY_FULL_BOOST_USD))
}

/** `score = 0.60·cosine + 0.25·keyword + 0.15·liquidityBoost` — exact,
 * pure, unit-tested with fixed inputs (AC 9). */
export function combineScore(
  cosine: number,
  keyword: number,
  boost: number
): number {
  return (
    WEIGHT_COSINE * cosine + WEIGHT_KEYWORD * keyword + WEIGHT_LIQUIDITY * boost
  )
}

/** Deterministic total order: `score` desc, tie-break `provider` asc then
 * `externalId` asc (the `@@unique` key) — identical output across runs
 * (AC 10), and shared by dedupe's "higher score survives" rule. */
function byScoreThenStableId(a: Candidate, b: Candidate): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.market.provider !== b.market.provider) {
    return a.market.provider < b.market.provider ? -1 : 1
  }
  return a.market.externalId < b.market.externalId ? -1 : 1
}

// ── Cross-provider dedupe (AC 11) ────────────────────────────────────────

/** Normalized question-token signature: tokenize, drop a small stopword
 * set, dedupe, sort, join — equal signatures are treated as the same
 * underlying real-world market (plan decision 6). */
export function questionSignature(question: string): string {
  const tokens = [...tokenize(question)].filter(t => !DEDUPE_STOPWORDS.has(t))
  tokens.sort()
  return tokens.join(' ')
}

/** Keeps the higher-scoring candidate per signature (tie-break `provider`
 * then `externalId`, same ordering as the final sort) — runs BEFORE the
 * top-15 cut (AC 11). */
export function dedupeByQuestionSignature(
  candidates: readonly Candidate[]
): Candidate[] {
  const bestBySignature = new Map<string, Candidate>()
  for (const candidate of candidates) {
    const signature = questionSignature(candidate.market.question)
    const existing = bestBySignature.get(signature)
    if (
      existing === undefined ||
      byScoreThenStableId(candidate, existing) < 0
    ) {
      bestBySignature.set(signature, candidate)
    }
  }
  return [...bestBySignature.values()]
}

// ── Row → NormalizedMarket mapper (shared by both default seams) ────────

const STATUS_FROM_ENUM: Record<MarketStatus, NormalizedMarket['status']> = {
  OPEN: 'open',
  CLOSED: 'closed',
  RESOLVED: 'resolved',
}

/** `MarketSnapshot` persists no `url`/slug — this derived URL is best-effort
 * (known gap, deferred; see plan design details §"Row → NormalizedMarket
 * mapper"). Mirrors the provider clients' own URL shape. */
function deriveMarketUrl(
  provider: NormalizedMarket['provider'],
  externalId: string
): string {
  return provider === 'kalshi'
    ? `https://kalshi.com/markets/${externalId}`
    : `https://polymarket.com/market/${externalId}`
}

interface SnapshotRow {
  readonly provider: Provider
  readonly externalId: string
  readonly question: string
  readonly eventTitle: string | null
  readonly searchText: string
  readonly category: string | null
  readonly yesPrice: number
  readonly noPrice: number
  readonly volumeUsd: number | null
  readonly liquidityUsd: number | null
  readonly closeTime: Date | null
  readonly status: MarketStatus
  readonly resolvedYes: boolean | null
}

function snapshotToNormalized(row: SnapshotRow): NormalizedMarket {
  const provider = fromProviderEnum(row.provider)
  return buildNormalizedMarket(
    {
      provider,
      externalId: row.externalId,
      question: row.question,
      searchText: row.searchText,
      yesPrice: row.yesPrice,
      noPrice: row.noPrice,
      status: STATUS_FROM_ENUM[row.status],
      url: deriveMarketUrl(provider, row.externalId),
    },
    {
      eventTitle: row.eventTitle ?? undefined,
      category: row.category ?? undefined,
      volumeUsd: row.volumeUsd ?? undefined,
      liquidityUsd: row.liquidityUsd ?? undefined,
      closeTime: row.closeTime ?? undefined,
      resolvedYes: row.resolvedYes ?? undefined,
    }
  )
}

// ── Default seams ─────────────────────────────────────────────────────────

/** Accepts a Prisma `Decimal`, a plain `number`, or a numeric `string` (raw
 * `$queryRaw` rows aren't guaranteed to come back as `Decimal` instances for
 * every column type) and coerces to `number` at this one boundary. */
const DecimalLikeSchema = z
  .union([z.instanceof(Prisma.Decimal), z.number(), z.string()])
  .transform(v => Number(v))

/** Validated shape of a `pgvectorTopK` row — Zod at the `$queryRaw`
 * boundary (ADR 001's read-side idiom), Decimal→number coercion included. */
const VectorRowSchema = z.object({
  provider: z.nativeEnum(Provider),
  externalId: z.string().min(1),
  question: z.string().min(1),
  eventTitle: z.string().nullable(),
  searchText: z.string().min(1),
  category: z.string().nullable(),
  yesPrice: DecimalLikeSchema,
  noPrice: DecimalLikeSchema,
  volumeUsd: DecimalLikeSchema.nullable(),
  liquidityUsd: DecimalLikeSchema.nullable(),
  closeTime: z.date().nullable(),
  status: z.nativeEnum(MarketStatus),
  resolvedYes: z.boolean().nullable(),
  cosine: DecimalLikeSchema,
})

/**
 * Nearest ≤`k` **open** markets by cosine similarity to `queryVector` — one
 * `$queryRaw`, `<=>` cosine distance per ADR 001's read-side idiom (AC 14).
 * Never `SELECT`s `embedding` into JS (only inside `<=>`/`IS NOT NULL`).
 * Malformed rows are skipped rather than aborting the whole read (mirrors
 * sync's per-row resilience) — a corrupt row must not take retrieval down.
 */
async function pgvectorTopK(
  queryVector: number[],
  k: number
): Promise<ScoredMarket[]> {
  const literal = `[${queryVector.join(',')}]`
  const rows = await db.$queryRaw<unknown[]>`
    SELECT provider, "externalId", question, "eventTitle", "searchText", category,
           "yesPrice", "noPrice", "volumeUsd", "liquidityUsd", "closeTime",
           status, "resolvedYes", 1 - (embedding <=> ${literal}::vector) AS cosine
    FROM "MarketSnapshot"
    WHERE embedding IS NOT NULL AND status = 'OPEN'::"MarketStatus"
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${k}`

  const scored: ScoredMarket[] = []
  for (const raw of rows) {
    const parsed = VectorRowSchema.safeParse(raw)
    if (!parsed.success) continue
    const { cosine, ...row } = parsed.data
    scored.push({ market: snapshotToNormalized(row), cosine })
  }
  return scored
}

/**
 * Degraded-mode candidate pool (embed failed → no vector KNN available):
 * bounded `findMany` over open markets ordered by liquidity, scalar columns
 * only (Prisma can't select the `Unsupported` `embedding` column anyway).
 * Not Redis's hot catalog — `HotMarket` lacks `question`/`url` needed to
 * build a valid `NormalizedMarket`, and this path exists for a NIM outage,
 * not a Postgres outage (plan decision 5).
 */
async function loadOpenMarketPool(): Promise<NormalizedMarket[]> {
  const rows = await db.marketSnapshot.findMany({
    where: { status: MarketStatus.OPEN },
    orderBy: { liquidityUsd: 'desc' },
    take: DEGRADED_POOL_SIZE,
    select: {
      provider: true,
      externalId: true,
      question: true,
      eventTitle: true,
      searchText: true,
      category: true,
      yesPrice: true,
      noPrice: true,
      volumeUsd: true,
      liquidityUsd: true,
      closeTime: true,
      status: true,
      resolvedYes: true,
    },
  })

  return rows.map(row =>
    snapshotToNormalized({
      ...row,
      yesPrice: Number(row.yesPrice),
      noPrice: Number(row.noPrice),
      volumeUsd: row.volumeUsd === null ? null : Number(row.volumeUsd),
      liquidityUsd: row.liquidityUsd === null ? null : Number(row.liquidityUsd),
    })
  )
}

// ── Orchestration ─────────────────────────────────────────────────────────

/**
 * `retrieveCandidates` NEVER throws when only `embed` fails — it degrades to
 * keyword-only scoring (every `cosine === 0`, AC 15) with the full hard-
 * filter set still applied (AC 16). A Postgres failure (either `vectorTopK`
 * or the degraded-mode `keywordPool`) DOES propagate — this function only
 * catches the embedding step, not the DB reads (plan decision 5 / risk #3).
 */
export async function retrieveCandidates(
  spec: HedgeSpec,
  rawPrompt: string,
  deps: RetrieveDeps = {}
): Promise<Candidate[]> {
  const embed = deps.embed ?? embedText
  const vectorTopK = deps.vectorTopK ?? pgvectorTopK
  const keywordPool = deps.keywordPool ?? loadOpenMarketPool

  let queryVector: number[] | undefined
  try {
    queryVector = await embed(spec.riskDescription)
  } catch {
    queryVector = undefined
  }

  const scored: ScoredMarket[] =
    queryVector === undefined
      ? (await keywordPool()).map(market => ({ market, cosine: 0 }))
      : await vectorTopK(queryVector, VECTOR_TOP_K)

  const survivors = scored.filter(s => passesHardFilters(s.market, spec))

  const candidates: Candidate[] = survivors.map(s => {
    const keyword = keywordScore(s.market, spec, rawPrompt)
    const boost = liquidityBoost(s.market.liquidityUsd)
    return {
      market: s.market,
      cosine: s.cosine,
      keyword,
      score: combineScore(s.cosine, keyword, boost),
    }
  })

  const deduped = dedupeByQuestionSignature(candidates)
  return deduped.sort(byScoreThenStableId).slice(0, MAX_CANDIDATES)
}
