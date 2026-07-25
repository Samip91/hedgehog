import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Manifest shape (spec `docs/features/hardening/spec.md` AC 20). Hedgehog's
 * manifest is a plain static file (`public/manifest.webmanifest`) linked
 * from `layout.tsx`'s `metadata.manifest` — not a Next `app/manifest.ts`
 * metadata route — so this reads + parses it directly.
 */

interface ManifestIcon {
  src: string
  sizes: string
  type: string
  purpose?: string
}

interface Manifest {
  display: string
  start_url: string
  icons: ManifestIcon[]
}

function loadManifest(): Manifest {
  const manifestPath = fileURLToPath(
    new URL('../../public/manifest.webmanifest', import.meta.url)
  )
  return JSON.parse(readFileSync(manifestPath, 'utf-8')) as Manifest
}

function publicPath(name: string): string {
  return fileURLToPath(new URL(`../../public/${name}`, import.meta.url))
}

describe('public/manifest.webmanifest — shape (AC 20)', () => {
  const manifest = loadManifest()

  it('display: standalone', () => {
    expect(manifest.display).toBe('standalone')
  })

  it("start_url: '/'", () => {
    expect(manifest.start_url).toBe('/')
  })

  it('has a ≥512×512 image/png icon whose purpose includes maskable', () => {
    const icon512 = manifest.icons.find(i => i.sizes === '512x512')

    expect(icon512).toBeDefined()
    expect(icon512?.type).toBe('image/png')
    expect(icon512?.purpose ?? '').toContain('maskable')
  })

  it('has a 192×192 image/png icon', () => {
    const icon192 = manifest.icons.find(i => i.sizes === '192x192')

    expect(icon192).toBeDefined()
    expect(icon192?.type).toBe('image/png')
  })

  it('keeps the existing svg icon entry (replacing was svg-only, not removing svg)', () => {
    const svgIcon = manifest.icons.find(i => i.type === 'image/svg+xml')

    expect(svgIcon).toBeDefined()
    expect(svgIcon?.src).toBe('/icon.svg')
  })

  it('every icon entry has a resolvable src, sizes, and type', () => {
    for (const icon of manifest.icons) {
      expect(icon.src.length).toBeGreaterThan(0)
      expect(icon.sizes.length).toBeGreaterThan(0)
      expect(icon.type.length).toBeGreaterThan(0)
    }
  })
})

describe('PWA icon assets referenced by layout.tsx exist on disk (AC 20, 21)', () => {
  it.each([
    'icon-192.png',
    'icon-512.png',
    'apple-touch-icon.png',
    'favicon.ico',
  ])('public/%s exists', filename => {
    expect(existsSync(publicPath(filename))).toBe(true)
  })
})
