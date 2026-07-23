import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
}

export default defineConfig({
  resolve: { alias },
  test: {
    // Unit tests only. Playwright owns e2e (evals has its own tsx runner).
    // Two projects, split by extension so environment selection never depends
    // on a shared global flag — backend (`.ts`) tests can't accidentally load
    // jsdom, and UI (`.tsx`) tests can't accidentally run under `node`.
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.{test,spec}.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/**/*.{test,spec}.tsx'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/shared/**', 'src/server/**'],
    },
  },
})
