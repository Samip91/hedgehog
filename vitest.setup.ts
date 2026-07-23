import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

// Recharts' ResponsiveContainer relies on ResizeObserver, which jsdom does not
// implement. A minimal stub is enough for render + interaction tests (no real
// resize events are needed in jsdom, which has a zero-size layout anyway).
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

global.ResizeObserver = ResizeObserverStub
