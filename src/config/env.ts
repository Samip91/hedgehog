import 'server-only'
import { z } from 'zod'

/**
 * Single source of truth for environment configuration.
 *
 * Rules (see docs/PITFALLS.md):
 *  - Nothing else in the codebase reads `process.env` directly.
 *  - Validation is fail-fast: a missing/invalid var throws at startup with a
 *    named list, not a mysterious `undefined` deep in a request.
 *  - `SKIP_ENV_VALIDATION=1` bypasses validation for `next build` / tooling
 *    that must run without real secrets (CI build step, Docker image bake).
 *
 * This module is server-only. Never import it into a Client Component; expose
 * public values through `NEXT_PUBLIC_*` instead.
 */
const schema = z.object({
  // Datastores
  DATABASE_URL: z.string().min(1),
  UPSTASH_REDIS_REST_URL: z.string().min(1),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),

  // NVIDIA NIM — chat + embeddings, one key
  NVIDIA_API_KEY: z.string().min(1),
  NVIDIA_BASE_URL: z
    .string()
    .min(1)
    .default('https://integrate.api.nvidia.com/v1'),
  LLM_PARSE_MODEL: z.string().min(1).default('meta/llama-3.1-8b-instruct'),
  LLM_RERANK_MODEL: z.string().min(1).default('meta/llama-3.3-70b-instruct'),
  EMBEDDING_MODEL: z.string().min(1).default('nvidia/nv-embedqa-e5-v5'),
  // Must equal the `vector(N)` dimension in prisma/schema.prisma.
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1024),

  // Protects /api/cron/sync
  CRON_SECRET: z.string().min(16),

  // Public
  NEXT_PUBLIC_APP_URL: z.string().min(1).default('http://localhost:3000'),

  // Rate limits (spec docs/features/hardening/spec.md AC 1-9) — per-bucket
  // limit/window, all env-tunable with sane defaults.
  RL_HEDGES_SAVE_LIMIT: z.coerce.number().int().positive().default(20),
  RL_HEDGES_SAVE_WINDOW: z.coerce.number().int().positive().default(600),
  RL_HEDGES_READ_LIMIT: z.coerce.number().int().positive().default(60),
  RL_HEDGES_READ_WINDOW: z.coerce.number().int().positive().default(60),
  RL_HEDGES_DELETE_LIMIT: z.coerce.number().int().positive().default(30),
  RL_HEDGES_DELETE_WINDOW: z.coerce.number().int().positive().default(60),
  RL_HEALTH_LIMIT: z.coerce.number().int().positive().default(120),
  RL_HEALTH_WINDOW: z.coerce.number().int().positive().default(60),

  // Structured logging (docs/features/hardening/spec.md AC 14-17)
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
})

export type Env = z.infer<typeof schema>

function loadEnv(): Env {
  if (process.env.SKIP_ENV_VALIDATION) {
    // Best-effort during build/tooling: apply defaults, don't throw on gaps.
    return schema.partial().parse(process.env) as unknown as Env
  }

  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map(issue => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(
      `Invalid environment variables — check your .env against .env.example:\n${details}`
    )
  }
  return parsed.data
}

export const env = loadEnv()
