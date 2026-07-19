# 🦔 Hedgehog

**Hedge your everyday risk with live prediction markets.** Describe a real-life
risk in plain English — _"I lose $500 if it rains during my beach wedding in
Miami on March 21"_ — and Hedgehog parses it, finds the live market that hedges
it (Kalshi, Polymarket), and shows a sized hedge with a full payoff breakdown.

Mobile-first, installable PWA. Simulated fills at live odds (no real orders).

> **Status:** foundation scaffold. The pipeline and screens are stubbed and land
> feature-by-feature via the workflow in `CONTRIBUTING.md`. See
> `docs/tasks/backlog.md` for the delivery order.

## What it does

- Turns natural-language risk into a structured `HedgeSpec` (LLM parse).
- Finds matching live markets with **hybrid retrieval** (pgvector semantic search
  + keyword + hard filters → LLM rerank).
- Proposes a sized hedge with payoff math, coverage %, and a P&L tracker.

## How it works

A cron-driven sync keeps Postgres (pgvector) and Redis warm; **the request path
never calls providers**. See [`docs/architecture.md`](docs/architecture.md) for
the diagram and pipeline, and [`docs/adr/`](docs/adr) for the decisions.

## Tech

Next.js 16 (App Router) · React 19 · TypeScript (strict-plus) · Tailwind v4 +
shadcn · TanStack Query v5 · Prisma 6 + pgvector · Zod · NVIDIA NIM (chat +
embeddings) · Vitest + Playwright · pnpm.

## Local setup

```bash
pnpm install
cp .env.example .env.local     # fill in values (all validated by src/config/env.ts)
pnpm db:generate               # generate the Prisma client
pnpm dev                       # http://localhost:3000
```

Quality gates:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm evals && pnpm build
```

> The DB is optional to boot the UI. To use persistence, point `DATABASE_URL` at a
> Neon Postgres, run `prisma/sql/001_enable_pgvector.sql`, then `pnpm db:migrate`.

## Environment

See [`.env.example`](.env.example). One `NVIDIA_API_KEY` powers both chat and
embeddings. No provider API keys are needed for market data. Secrets live in your
deploy env only — see the key-rotation runbook in `CONTRIBUTING.md`.

## Contributing

Branching model, commit conventions, and the multi-agent workflow are in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Roadmap

Real order execution (provider trading APIs + funded wallets + KYC), SSE live
prices, embedded-wallet auth, feedback-loop ranking, more providers. Rationale
for each current scope decision is in the ADRs.
