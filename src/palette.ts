// Tasteful palette generation + image palette extraction.
// Dark schemes: vivid hues anchored by a tinted near-black, often lifted by cream.
// Light schemes: cream/pastel fields with one saturated accent.

import { hexToRgb, hslHex, rgbToHex, type Mode } from './engine'

type Rand = () => number

const pick = <T,>(rand: Rand, arr: T[]): T => arr[Math.floor(rand() * arr.length)]
const range = (rand: Rand, min: number, max: number) => min + rand() * (max - min)

function nearBlack(rand: Rand, hue: number): string {
  return hslHex(hue + range(rand, -20, 20), range(rand, 20, 45), range(rand, 4, 9))
}

function cream(rand: Rand): string {
  return hslHex(range(rand, 38, 55), range(rand, 45, 75), range(rand, 84, 92))
}

const DARK_SCHEMES = ['analogous', 'complement', 'ember', 'noir', 'triad'] as const
const LIGHT_SCHEMES = ['dawn', 'paper', 'sorbet', 'mist'] as const

function hexToHsl(hex: string): [number, number, number] {
  const [r8, g8, b8] = hexToRgb(hex)
  const r = r8 / 255
  const g = g8 / 255
  const b = b8 / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s * 100, l * 100]
}

// hue offsets from the dominant color that read as intentional rather than muddy:
// same family, analogous, split-complement, complement — never the 90–140° clash zone
const HARMONIC_ANCHORS = [0, 28, -28, 55, -55, 150, -150, 180]

/**
 * Gently pull each vivid color's hue toward the nearest harmonic anchor relative
 * to the palette's dominant hue. Neutrals, near-blacks, and creams pass through.
 * Only applied to palettes WE generate — user-picked colors are never touched.
 */
function harmonize(colors: string[]): string[] {
  const hsl = colors.map(hexToHsl)
  let domIdx = 0
  let best = -1
  hsl.forEach(([, s, l], i) => {
    const score = s * (1 - Math.abs(l - 50) / 50)
    if (score > best) {
      best = score
      domIdx = i
    }
  })
  const dom = hsl[domIdx][0]
  return colors.map((c, i) => {
    const [h, s, l] = hsl[i]
    if (i === domIdx || s < 25 || l < 12 || l > 92) return c
    const rel = ((h - dom + 540) % 360) - 180
    let anchor = HARMONIC_ANCHORS[0]
    let min = Infinity
    for (const a of HARMONIC_ANCHORS) {
      const d = Math.abs(rel - a)
      if (d < min) {
        min = d
        anchor = a
      }
    }
    if (min < 10) return c
    const target = dom + anchor
    const nh = h + ((((target - h + 540) % 360) - 180) * 0.75)
    return hslHex(nh, s, l)
  })
}

export function randomPalette(rand: Rand, mode: Mode = 'dark'): string[] {
  const h = rand() * 360
  const scheme =
    mode === 'dark'
      ? pick(rand, [...DARK_SCHEMES])
      : mode === 'light'
        ? pick(rand, [...LIGHT_SCHEMES])
        : pick(rand, [...DARK_SCHEMES, ...LIGHT_SCHEMES])
  let colors: string[] = []

  switch (scheme) {
    case 'analogous':
      colors = [
        hslHex(h, range(rand, 75, 95), range(rand, 52, 64)),
        hslHex(h + 28, range(rand, 80, 95), range(rand, 58, 70)),
        hslHex(h + 58, range(rand, 70, 90), range(rand, 62, 74)),
        nearBlack(rand, h),
      ]
      if (rand() < 0.5) colors.push(cream(rand))
      break
    case 'complement':
      colors = [
        hslHex(h, range(rand, 80, 95), range(rand, 52, 62)),
        hslHex(h + 180, range(rand, 75, 90), range(rand, 58, 68)),
        hslHex(h + 18, range(rand, 85, 95), range(rand, 68, 78)),
        nearBlack(rand, h + 180),
      ]
      break
    case 'ember': {
      const hh = range(rand, -8, 40)
      colors = [
        hslHex(hh, range(rand, 88, 100), range(rand, 48, 58)),
        hslHex(hh + 22, range(rand, 90, 100), range(rand, 55, 62)),
        hslHex(hh + 48, range(rand, 92, 100), range(rand, 60, 68)),
        nearBlack(rand, hh + 10),
      ]
      break
    }
    case 'noir':
      colors = [
        hslHex(h, range(rand, 75, 92), range(rand, 50, 60)),
        hslHex(h + range(rand, -12, 12), range(rand, 60, 80), range(rand, 26, 36)),
        nearBlack(rand, h),
      ]
      if (rand() < 0.5) colors.push(hslHex(h + range(rand, 30, 60), range(rand, 75, 90), range(rand, 60, 72)))
      break
    case 'triad':
      colors = [
        hslHex(h, range(rand, 80, 95), range(rand, 52, 63)),
        hslHex(h + range(rand, 125, 155), range(rand, 75, 90), range(rand, 55, 68)),
        hslHex(h + range(rand, 215, 250), range(rand, 75, 90), range(rand, 58, 70)),
        nearBlack(rand, h),
      ]
      break
    case 'dawn':
      colors = [
        hslHex(h, range(rand, 60, 80), range(rand, 76, 84)),
        hslHex(h + 42, range(rand, 55, 75), range(rand, 70, 80)),
        hslHex(h + 85, range(rand, 50, 70), range(rand, 66, 76)),
        hslHex(h + range(rand, 10, 40), range(rand, 75, 90), range(rand, 55, 63)),
        cream(rand),
      ]
      break
    case 'paper':
      colors = [
        cream(rand),
        hslHex(h, range(rand, 55, 80), range(rand, 76, 86)),
        hslHex(h + range(rand, 25, 50), range(rand, 50, 75), range(rand, 70, 82)),
        hslHex(h + range(rand, -15, 15), range(rand, 78, 95), range(rand, 56, 66)),
      ]
      break
    case 'sorbet': {
      const hh = rand() < 0.5 ? range(rand, -30, 60) : range(rand, 290, 360)
      colors = [
        hslHex(hh, range(rand, 65, 85), range(rand, 78, 88)),
        hslHex(hh + range(rand, 20, 45), range(rand, 70, 90), range(rand, 74, 84)),
        hslHex(hh + range(rand, 50, 90), range(rand, 60, 80), range(rand, 76, 86)),
        hslHex(hh + range(rand, 0, 30), range(rand, 80, 95), range(rand, 62, 70)),
      ]
      break
    }
    case 'mist': {
      const hh = range(rand, 170, 280)
      colors = [
        hslHex(hh, range(rand, 25, 45), range(rand, 76, 88)),
        hslHex(hh + range(rand, 15, 40), range(rand, 20, 40), range(rand, 70, 82)),
        hslHex(hh - range(rand, 10, 30), range(rand, 30, 50), range(rand, 80, 90)),
        hslHex(hh + range(rand, -20, 20), range(rand, 55, 75), range(rand, 58, 68)),
      ]
      break
    }
  }

  colors = harmonize(colors)

  // shuffle so the anchor lands in different spots for linear/waves styles
  for (let i = colors.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[colors[i], colors[j]] = [colors[j], colors[i]]
  }
  return colors
}

function dist(a: [number, number, number], b: [number, number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/** dominant vibrant colors from an already-drawn sample canvas */
export function paletteFromCanvas(c: HTMLCanvasElement): string[] {
  const x = c.getContext('2d')!
  const d = x.getImageData(0, 0, c.width, c.height).data

  // bucket into a coarse rgb cube, scoring vibrant mid-tones higher
  const buckets = new Map<number, { r: number; g: number; b: number; n: number; score: number }>()
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const sat = max === 0 ? 0 : (max - min) / max
    const lum = (max + min) / 510
    const vib = sat * 1.5 + (1 - Math.abs(lum - 0.5))
    let e = buckets.get(key)
    if (!e) {
      e = { r: 0, g: 0, b: 0, n: 0, score: 0 }
      buckets.set(key, e)
    }
    e.r += r
    e.g += g
    e.b += b
    e.n++
    e.score += vib
  }

  const sorted = [...buckets.values()].sort((a, b) => b.score - a.score)
  const out: string[] = []
  for (const e of sorted) {
    const rgb: [number, number, number] = [e.r / e.n, e.g / e.n, e.b / e.n]
    if (out.some((hex) => dist(hexToRgb(hex), rgb) < 80)) continue
    out.push(rgbToHex(rgb[0], rgb[1], rgb[2]))
    if (out.length === 5) break
  }
  return out
}

export interface ImageImport {
  colors: string[]
  /** small cover-crop canvas used as the 'image' style's color field */
  field: HTMLCanvasElement
}

async function importBitmap(bmp: ImageBitmap): Promise<ImageImport> {
  const long = 256
  const k = long / Math.max(bmp.width, bmp.height)
  const field = document.createElement('canvas')
  field.width = Math.max(8, Math.round(bmp.width * k))
  field.height = Math.max(8, Math.round(bmp.height * k))
  field.getContext('2d')!.drawImage(bmp, 0, 0, field.width, field.height)
  bmp.close()

  const sample = document.createElement('canvas')
  sample.width = 64
  sample.height = 64
  sample.getContext('2d')!.drawImage(field, 0, 0, 64, 64)
  return { colors: paletteFromCanvas(sample), field }
}

export async function importImage(file: File): Promise<ImageImport> {
  return importBitmap(await createImageBitmap(file))
}

export async function importImageUrl(url: string): Promise<ImageImport> {
  const res = await fetch(url)
  return importBitmap(await createImageBitmap(await res.blob()))
}
