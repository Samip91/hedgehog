import { z } from 'zod'
import { env } from '@/config/env'
import { fetchJson, SchemaMismatchError } from '@/server/http'
import { payloadPreview } from '@/server/providers/normalize'
import { HedgeSpecSchema, type HedgeSpec } from '@/shared/schemas'
import {
  buildMessages,
  buildRetryMessages,
  type ChatMessage,
} from './parse-prompt'
import { degradedSpec } from './degraded-parse'

/**
 * Stage 1 — free text → HedgeSpec (spec §6.1).
 * Small model, JSON-only, Zod safeParse with ONE retry feeding the validation
 * error back. Degraded mode: on model failure, callers fall back to keyword-only
 * over the raw user text.
 */

export type { ChatMessage }
export type ChatFn = (messages: ChatMessage[]) => Promise<string>
export interface ParseDeps {
  chat?: ChatFn
}

const NimChatResponseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
})

/** The only code in this module that touches the network. */
export async function chatComplete(messages: ChatMessage[]): Promise<string> {
  const raw = await fetchJson<unknown>(
    `${env.NVIDIA_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${env.NVIDIA_API_KEY}` },
      body: {
        model: env.LLM_PARSE_MODEL,
        messages,
        temperature: 0,
        response_format: { type: 'json_object' },
      },
    }
  )

  const parsed = NimChatResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new SchemaMismatchError('NIM chat response', payloadPreview(raw))
  }

  // Length-guarded by `.min(1)` above; use an explicit check, not `!`.
  const first = parsed.data.choices[0]
  if (first === undefined) {
    throw new SchemaMismatchError('NIM chat response', payloadPreview(raw))
  }
  return first.message.content
}

type ParseResult =
  { success: true; data: HedgeSpec } | { success: false; issues: string }

/** Strip a ```json fence if present, then fall back to first-`{`…last-`}`. */
function extractJsonObject(content: string): unknown | null {
  const trimmed = content.trim()
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  const unfenced = (fenceMatch ? fenceMatch[1] : trimmed) ?? trimmed

  try {
    return JSON.parse(unfenced) as unknown
  } catch {
    // fall through to brace-slice recovery
  }

  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(unfenced.slice(start, end + 1)) as unknown
  } catch {
    return null
  }
}

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

/** `chat`, swallowing network/HTTP errors into `null` for the degraded-mode check. */
async function tryChat(
  chat: ChatFn,
  messages: ChatMessage[]
): Promise<string | null> {
  try {
    return await chat(messages)
  } catch {
    return null
  }
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
