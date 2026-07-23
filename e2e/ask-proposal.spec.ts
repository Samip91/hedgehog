import { expect, test } from '@playwright/test'
import type { ApiResponse } from '@/shared/schemas'
import type { HedgeMatch, HedgeProposal } from '@/shared/proposal'
import { computeHedge } from '@/shared/hedgeMath'
import { formatUsd } from '@/features/hedge/lib/format'

/**
 * Ask → proposal → payoff-slider smoke (spec `ui-ask-proposal`, ACs 1, 3, 7–9).
 * Runs against the real Next dev server at 390px (Pixel 7, `playwright.config.ts`)
 * but stubs `POST /api/hedge` via `page.route` — the sandbox cannot reach the
 * live NIM/DB pipeline, so this exercises the UI only, not the backend.
 * Single smoke spec by design (plan §Tests, "Keep it a SINGLE smoke spec").
 */

const PRICE = 0.4
const EXPOSURE = 500
const SEED_STAKE = 300
const seedPayoff = computeHedge({
  stakeUsd: SEED_STAKE,
  price: PRICE,
  exposureUsd: EXPOSURE,
})

const best: HedgeMatch = {
  provider: 'kalshi',
  externalId: 'K-RAIN-MIA',
  question: 'Will it rain in Miami on March 21, 2026?',
  url: 'https://kalshi.com/markets/K-RAIN-MIA',
  closeTime: '2026-03-21T00:00:00Z',
  yesPrice: PRICE,
  noPrice: 1 - PRICE,
  liquidityUsd: 20_000,
  side: 'YES',
  relevance: 'high',
  reasoning: 'Rain in Miami on the wedding date pays out on this YES side.',
  price: PRICE,
  sized: true,
  stakeUsd: SEED_STAKE,
  shares: seedPayoff.shares,
  payoutIfWin: seedPayoff.payoutIfWin,
  netIfBadOutcome: seedPayoff.netIfBadOutcome,
  netIfGoodOutcome: seedPayoff.netIfGoodOutcome,
  coverageRatio: seedPayoff.coverageRatio,
  coveragePct: seedPayoff.coveragePct,
}

const alternative: HedgeMatch = {
  provider: 'polymarket',
  externalId: 'P-RAIN-MIA-ALT',
  question: 'Will Miami get 1+ inch of rain the week of March 21?',
  url: 'https://polymarket.com/event/rain-mia-alt',
  closeTime: '2026-03-21T00:00:00Z',
  yesPrice: 0.3,
  noPrice: 0.7,
  liquidityUsd: 5_000,
  side: 'YES',
  relevance: 'partial',
  reasoning: 'A broader rain window, partial match.',
  price: 0.3,
  sized: false,
  stakeUsd: null,
  shares: null,
  payoutIfWin: null,
  netIfBadOutcome: null,
  netIfGoodOutcome: null,
  coverageRatio: null,
  coveragePct: null,
}

const cannedProposal: ApiResponse<HedgeProposal> = {
  ok: true,
  data: {
    spec: {
      riskDescription: 'Financial loss from rain at an outdoor wedding',
      domain: 'weather',
      direction: 'happens',
      exposureUsd: EXPOSURE,
      deadline: '2026-03-21',
      location: 'Miami',
      asset: null,
      threshold: null,
      confidence: 'high',
      clarificationNeeded: null,
    },
    best,
    alternatives: [alternative],
  },
}

test('ask a risk → see the parsed risk + best match → drag the stake slider updates the payoff', async ({
  page,
}) => {
  await page.route('**/api/hedge', route =>
    route.fulfill({ json: cannedProposal })
  )

  await page.goto('/')

  await page
    .getByLabel(/describe your risk/i)
    .fill(
      'I lose $500 if it rains during my beach wedding in Miami on March 21.'
    )
  await page.getByRole('button', { name: /find my hedge/i }).click()

  // Parsed-risk card + best-match card render (AC 1, 3, 5, 7).
  await expect(page.getByText(/what we understood/i)).toBeVisible()
  await expect(page.getByText(best.question)).toBeVisible()
  await expect(page.getByText('Kalshi')).toBeVisible()
  await expect(page.getByText(formatUsd(SEED_STAKE))).toBeVisible()

  // Drag the stake slider and confirm the payoff number changes (AC 8, 9, 10).
  const netIfHappens = page
    .locator('p', { hasText: 'If it happens' })
    .locator('xpath=following-sibling::p[1]')
  const before = await netIfHappens.innerText()

  const slider = page.locator('#stake-sized')
  await expect(slider).toBeVisible()
  await slider.fill('600')

  const newStake = 600
  const newPayoff = computeHedge({
    stakeUsd: newStake,
    price: PRICE,
    exposureUsd: EXPOSURE,
  })

  await expect(netIfHappens).not.toHaveText(before)
  await expect(netIfHappens).toHaveText(formatUsd(newPayoff.netIfBadOutcome))
  await expect(page.getByText(formatUsd(newStake))).toBeVisible()
})
