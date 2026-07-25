import 'server-only'
import { env } from '@/config/env'

/**
 * Small structured JSON logger (spec docs/features/hardening/spec.md AC
 * 14-17) — no pino/winston dependency. Emits one JSON line per call via
 * `process.stdout.write` (never `console.*`, matching the zero-console
 * convention in `src/`), gated by `LOG_LEVEL`.
 *
 * Never logs the anon-id cookie, credentials, or a full raw prompt —
 * `redact()` strips known-sensitive keys and truncates `prompt`.
 */
type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_RANK: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

/** Keys that must never reach stdout, regardless of call site. */
const REDACTED_KEYS: ReadonlySet<string> = new Set([
  'anonId',
  'cookie',
  'authorization',
  'token',
  'secret',
  'apiKey',
  'password',
])

const PROMPT_TRUNCATE_LENGTH = 100

function redact(
  fields: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (fields === undefined) return {}

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (REDACTED_KEYS.has(key)) continue
    if (key === 'prompt' && typeof value === 'string') {
      result[key] =
        value.length > PROMPT_TRUNCATE_LENGTH
          ? `${value.slice(0, PROMPT_TRUNCATE_LENGTH)}…`
          : value
      continue
    }
    result[key] = value
  }
  return result
}

function emit(
  level: Level,
  msg: string,
  fields?: Record<string, unknown>
): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[env.LOG_LEVEL]) return

  const line = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...redact(fields),
  }
  process.stdout.write(`${JSON.stringify(line)}\n`)
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) =>
    emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) =>
    emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) =>
    emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) =>
    emit('error', msg, fields),
}

/** Short id stamped on 500 responses' logs — never returned to the client. */
export function newErrorId(): string {
  return crypto.randomUUID().slice(0, 8)
}
