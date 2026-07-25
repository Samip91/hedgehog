'use client'

import { useEffect } from 'react'

const isProduction = process.env.NODE_ENV === 'production'

/**
 * Registers `public/sw.js` on `load`, production builds only. Side-effect-only —
 * renders nothing, holds no state. Dev/test never register the SW (the offline
 * e2e spec needs a prod server for this reason).
 */
export function ServiceWorkerRegister(): null {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !isProduction) return

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
    window.addEventListener('load', register)
    return () => window.removeEventListener('load', register)
  }, [])

  return null
}
