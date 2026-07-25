import { expect, test } from '@playwright/test'

/**
 * Offline app-shell smoke (spec `hardening`, AC 18–19).
 * REQUIRES a production server (`next build && next start`) — the service
 * worker (`public/sw.js`) registers only when `NODE_ENV==='production'`
 * (`src/app/service-worker-register.tsx`), so it never registers under the
 * default `pnpm dev` webServer used by `playwright.config.ts` or in the
 * sandbox. Same posture as `e2e/ask-proposal.spec.ts`'s stubbed-network note:
 * this spec is CI/manual-only, run against a built app, e.g.
 *   pnpm build && pnpm start &
 *   NEXT_PUBLIC_APP_URL=http://localhost:3000 pnpm exec playwright test e2e/offline.spec.ts
 */

test('installs a service worker and serves the offline shell when the network drops', async ({
  page,
  context,
}) => {
  await page.goto('/')

  // Wait for the SW to finish installing + activating before going offline,
  // otherwise the precache race would make this flaky.
  await page.evaluate(() => navigator.serviceWorker.ready)

  await context.setOffline(true)
  await page.reload()

  // Either the cached app shell ('/') or the '/offline' fallback should
  // render — never the browser's native offline error page.
  await expect(page.locator('body')).not.toContainText(
    /can[’']t reach this page|internet disconnected|dinosaur/i
  )
  await expect(page.getByText(/you're offline|hedgehog/i).first()).toBeVisible()

  await context.setOffline(false)
})
