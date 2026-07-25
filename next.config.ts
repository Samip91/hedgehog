import type { NextConfig } from 'next'
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants'
import { securityHeaders } from './src/config/security-headers'

export default function nextConfig(phase: string): NextConfig {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER

  return {
    async headers() {
      return [
        {
          source: '/(.*)',
          headers: securityHeaders(isDev),
        },
      ]
    },
  }
}
