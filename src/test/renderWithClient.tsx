import type { ReactElement, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'

/**
 * Shared jsdom test helper: `saved-hedges` mounts `useQueryClient()` deep in
 * the proposal tree (`SaveHedgeButton` → `useSaveHedge`) and in the `hedges`
 * slice's list/detail components, so every component test that renders one
 * of those trees needs a real `QueryClientProvider`. Mirrors
 * `src/app/providers.tsx`'s client config, with retries disabled so a
 * mocked-failure test doesn't hang retrying.
 */
function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

/**
 * Uses the `wrapper` render option (not a hand-wrapped element) so the
 * returned `rerender()` keeps re-wrapping with the same `QueryClientProvider`
 * — callers that `rerender(<Other prop={...} />)` (e.g. simulating a
 * resubmit) don't lose the provider.
 */
export function renderWithClient(ui: ReactElement): RenderResult {
  const queryClient = createTestQueryClient()
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
  return render(ui, { wrapper: Wrapper })
}
