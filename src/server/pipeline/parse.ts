import { env } from '@/config/env'
import { HedgeSpecSchema, type HedgeSpec } from '@/shared/schemas'
import {
  buildMessages,
  buildRetryMessages,
  type ChatMessage,
} from './parse-prompt'
import {
  chatComplete as sharedChatComplete,
  extractJsonObject,
  tryChat,
  type ChatFn,
} from './nim-chat'
import { degradedSpec } from './degraded-parse'

/**
 * Stage 1 — free text → HedgeSpec (spec §6.1).
 * Small model, JSON-only, Zod safeParse with ONE retry feeding the validation
 * error back. Degraded mode: on model failure, callers fall back to keyword-only
 * over the raw user text.
 */

export type { ChatMessage, ChatFn }
export interface ParseDeps {
  chat?: ChatFn
}

/** Single-arg `chatComplete` bound to `LLM_PARSE_MODEL` (ADR 004) — preserves
 * this module's public surface post-extraction (`parse.test.ts` + the parse
 * eval stay green unmodified). The shared client is the only code that
 * touches the network. */
export async function chatComplete(messages: ChatMessage[]): Promise<string> {
  return sharedChatComplete(messages, env.LLM_PARSE_MODEL)
}

type ParseResult =
  { success: true; data: HedgeSpec } | { success: false; issues: string }

/** JSON extraction + `HedgeSpecSchema.safeParse`, uniform failure shape. */
export function extractAndParse(content: string): ParseResult {
  const obj = extractJsonObject(content)
  if (obj === null) {
    return { success: false, issues: 'response was not valid JSON' }
  }
  const parsed = HedgeSpecSchema.safeParse(obj)
  if (parsed.success) return { success: true, data: parsed.data }
  const issues = JSON.stringify(
    parsed.error.issues.map(i => ({ path: i.path, message: i.message }))
  )
  return { success: false, issues }
}

export async function parseRisk(
  prompt: string,
  deps: ParseDeps = {}
): Promise<HedgeSpec> {
  const chat = deps.chat ?? chatComplete
  const messages = buildMessages(prompt)

  const raw1 = await tryChat(chat, messages)
  if (raw1 === null) return degradedSpec(prompt)

  const p1 = extractAndParse(raw1)
  if (p1.success) return p1.data

  const retryMessages = buildRetryMessages(messages, raw1, p1.issues)

  const raw2 = await tryChat(chat, retryMessages)
  if (raw2 === null) return degradedSpec(prompt)

  const p2 = extractAndParse(raw2)
  return p2.success ? p2.data : degradedSpec(prompt)
}
