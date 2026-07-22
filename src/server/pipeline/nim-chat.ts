import { z } from 'zod'
import { env } from '@/config/env'
import { fetchJson, SchemaMismatchError } from '@/server/http'
import { payloadPreview } from '@/server/providers/normalize'

/**
 * Shared NIM chat-completions client (ADR 004) — extracted out of `parse.ts`
 * once rerank introduced the second chat caller (ADR 002's stated upgrade
 * path). Both `parse.ts` (bound to `LLM_PARSE_MODEL`) and `rank.ts` (bound to
 * `LLM_RERANK_MODEL`) call `chatComplete(messages, model)` through this one
 * module — same auth/parsing/error-handling, no duplication.
 */

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}
export type ChatFn = (messages: ChatMessage[]) => Promise<string>

export const NimChatResponseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
})

/**
 * The only code in this module that touches the network. `temperature: 0` +
 * `response_format: json_object` are hardcoded for both callers (no `opts` —
 * YAGNI per ADR 004; widen only when a third caller needs otherwise).
 */
export async function chatComplete(
  messages: ChatMessage[],
  model: string
): Promise<string> {
  const raw = await fetchJson<unknown>(
    `${env.NVIDIA_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${env.NVIDIA_API_KEY}` },
      body: {
        model,
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

/** `chat`, swallowing network/HTTP errors into `null` for the degraded-mode
 * check (shared by `parse.ts` and `rank.ts` — both retry skeletons need the
 * same "was this a transport failure?" signal before validating). */
export async function tryChat(
  chat: ChatFn,
  messages: ChatMessage[]
): Promise<string | null> {
  try {
    return await chat(messages)
  } catch {
    return null
  }
}

/** Strip a ```json fence if present, then fall back to first-`{`…last-`}`. */
export function extractJsonObject(content: string): unknown | null {
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
