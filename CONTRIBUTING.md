# Contributing to Hedgehog

This is the team-shared rulebook — committed to the repo so every clone carries
it. It's enforced by git hooks (husky) so it applies to everyone, not just
AI-assisted contributors.

## Branching model (git-flow)

```
main        production. protected. release tags only.
  ▲
develop     integration branch. features merge here.
  ▲
feature/{domain}-{description}   e.g. feature/providers-day1, feature/parse-fewshots
fix/{domain}-{description}       e.g. fix/retrieve-dedupe
hotfix/{description}             branched off main for prod-critical fixes
```

- **Never commit directly to `main` or `develop`.** The `pre-commit` hook blocks
  it. Branch off `develop` with `feature/…` or `fix/…`.
- Squash-merge a feature into `develop`; keep one logical slice per PR.
- `develop → main` only when CI is green.

## Commits — Conventional Commits

```
<type>(optional-scope): <subject>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `build`,
`ci`, `revert`. Enforced by the `commit-msg` hook (commitlint). One logical
change per commit.

## Local quality gates

Hooks run automatically; you can run them by hand:

```bash
pnpm typecheck      # tsc --noEmit (strict-plus)
pnpm lint           # eslint (no any, no non-null !)
pnpm test           # vitest
pnpm evals          # offline parse + retrieval evals
pnpm build          # next build
```

- `pre-commit` → lint-staged (prettier + eslint --fix on staged files) + gitleaks
  secret scan + branch guard.
- `commit-msg` → commitlint.
- `pre-push` → branch guard + `typecheck` + `test`.

## Code conventions

See `docs/tasks/conventions.md` for the cheat sheet and `docs/PITFALLS.md` for
traps. Highlights: Zod on every boundary, `Decimal` for money/probability, env
only via `src/config/env.ts`, feature-slice UI with a sibling `error.tsx`, and
`await params` on Next 16.

## Secrets & key rotation

Secrets live only in your deploy environment (e.g. Vercel), never in the repo.
`.env*` is gitignored except `.env.example`. To rotate a key: revoke it at the
provider → update the deploy env → redeploy. `CRON_SECRET` protects the sync
route; nothing sensitive is exposed under `NEXT_PUBLIC_`.
