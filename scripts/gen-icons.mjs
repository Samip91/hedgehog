#!/usr/bin/env node
/**
 * Zero-dependency icon generator (no `sharp`). Emits valid solid-`#0a0a0a`
 * PNG/ICO binaries for the PWA manifest + `<link>` icons, using only
 * `node:zlib` (deflate) and `node:fs`. Placeholders are acceptable per the
 * hardening plan — swap for branded art later.
 *
 * Run: `node scripts/gen-icons.mjs`
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(ROOT, '..', 'public')

/** Brand background — matches `viewport.themeColor` / manifest `background_color`. */
const COLOR = { r: 0x0a, g: 0x0a, b: 0x0a }

const CRC_TABLE = buildCrcTable()

function buildCrcTable() {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
}

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

/** Builds a valid, solid-color, non-interlaced 8-bit RGB PNG. */
function solidPng(size, { r, g, b }) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(size, 0) // width
  ihdrData.writeUInt32BE(size, 4) // height
  ihdrData[8] = 8 // bit depth
  ihdrData[9] = 2 // color type: RGB (truecolor, no alpha)
  ihdrData[10] = 0 // compression method
  ihdrData[11] = 0 // filter method
  ihdrData[12] = 0 // interlace method
  const ihdr = pngChunk('IHDR', ihdrData)

  const rowBytes = 1 + size * 3
  const raw = Buffer.alloc(rowBytes * size)
  for (let y = 0; y < size; y++) {
    const rowStart = y * rowBytes
    raw[rowStart] = 0 // filter type 0 (none) per scanline
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 3
      raw[px] = r
      raw[px + 1] = g
      raw[px + 2] = b
    }
  }
  const idat = pngChunk('IDAT', deflateSync(raw))
  const iend = pngChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([signature, ihdr, idat, iend])
}

/** Wraps a PNG buffer in a single-image ICO container (Vista+ PNG-in-ICO). */
function pngToIco(png, size) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: 1 = icon
  header.writeUInt16LE(1, 4) // image count

  const entry = Buffer.alloc(16)
  entry[0] = size >= 256 ? 0 : size // width (0 means 256)
  entry[1] = size >= 256 ? 0 : size // height
  entry[2] = 0 // color palette
  entry[3] = 0 // reserved
  entry.writeUInt16LE(1, 4) // color planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(png.length, 8) // size of image data
  entry.writeUInt32LE(header.length + entry.length, 12) // offset of image data

  return Buffer.concat([header, entry, png])
}

function writeIcon(relPath, buf) {
  const outPath = path.join(PUBLIC_DIR, relPath)
  writeFileSync(outPath, buf)
  console.log(`wrote ${relPath} (${buf.length} bytes)`)
}

const icon512 = solidPng(512, COLOR)
const icon192 = solidPng(192, COLOR)
const appleTouch = solidPng(180, COLOR)
const faviconSourcePng = solidPng(32, COLOR)
const favicon = pngToIco(faviconSourcePng, 32)

writeIcon('icon-512.png', icon512)
writeIcon('icon-192.png', icon192)
writeIcon('apple-touch-icon.png', appleTouch)
writeIcon('favicon.ico', favicon)
