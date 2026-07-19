# Conventions (quick reference)

The full rules live in `CONTRIBUTING.md`. This is the cheat sheet agents/humans
scan mid-task.

## Branches & commits

- `main` (protected) ← `develop` ← `feature/{domain}-{desc}` / `fix/{domain}-{desc}`.
- Never commit on `main` or `develop`. Hooks enforce it.
- Conventional Commits: `feat|fix|refactor|test|docs|chore|perf|build|ci|revert`.
- Squash-merge features into `develop`; one slice per PR.

## Code

- TypeScript strict-plus; no `any`, no non-null `!`.
- Zod-validate every external boundary (API input, provider payload, env).
- Money/probability = `Decimal` in the DB, `number` only at the math boundary.
- Feature-slice UI: `src/features/<domain>/{api,hooks,components,types,constants}` + barrel.
- Every `page.tsx` has a sibling `error.tsx`.
- Next 16: `await params`.
- Server state → TanStack Query only. No global store unless truly UI-only.

## Definition of done (per feature)

Typecheck + lint + unit tests + relevant evals pass; acceptance criteria in the
feature's `spec.md` are met; reviewer sign-off recorded in `review.md`.
