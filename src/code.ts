// Shareable "grainient codes": one human-readable line that captures every
// setting needed to reproduce a gradient exactly. The payload is a plain URL
// query string, so the same text works as a code, as app URL params, and as
// the data-grainient attribute in HTML embeds.
//
//   grainient:v1?style=rise&mode=mix&seed=123&colors=1a1a2e-7b6cff&ratio=16:9&grain=0.5…
//
// Page codes stitch several gradients into one scrollable page, one code per line:
//
//   grainient-page:v1
//   grainient:v1?style=rise&seed=1&ratio=21:9…
//   grainient:v1?style=waves&seed=2&ratio=16:9…

import { mulberry32, type AsciiSet, type GrainType, type Mode, type Settings, type Style } from './engine'
import { randomPalette } from './palette'

export const STYLES: Style[] = ['mesh', 'bloom', 'rise', 'set', 'waves', 'horizon', 'beams', 'spotlight', 'linear', 'radial']
export const MODES: Mode[] = ['dark', 'light', 'mix']
export const ASCII_SETS_UI: AsciiSet[] = ['classic', 'code', 'dots', 'heavy']
export const GRAIN_TYPES: GrainType[] = ['film', 'coarse', 'pixel', 'dither']

export const RATIOS: [string, number][] = [
  ['21:9', 21 / 9],
  ['16:9', 16 / 9],
  ['3:2', 3 / 2],
  ['1:1', 1],
  ['4:5', 4 / 5],
  ['9:16', 9 / 16],
]

/** accepts "16:9", "1920x600", "4/3", or a bare number like "2.35" */
export function parseRatio(v: string | null): number | null {
  if (!v) return null
  const t = v.trim()
  const m = t.match(/^(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)$/i)
  const r = m ? Number(m[1]) / Number(m[2]) : /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : NaN
  if (!isFinite(r) || r <= 0) return null
  return Math.min(16, Math.max(1 / 16, r))
}

export function ratioParam(ratio: number): string {
  const preset = RATIOS.find(([, r]) => Math.abs(ratio - r) < 0.001)
  if (preset) return preset[0]
  return String(Math.round(ratio * 10000) / 10000)
}

/** the fixed baseline codes are decoded against — matches the app's initial look */
export function baseSettings(seed = 1): Settings {
  return {
    seed,
    style: 'rise',
    mode: 'mix',
    colors: randomPalette(mulberry32(seed), 'mix'),
    grain: 0.49,
    grainType: 'film',
    softness: 0.45,
    vignette: 0.12,
    ascii: { enabled: true, size: 11, opacity: 0.67, density: 0.51, contrast: 0.3, set: 'code' },
  }
}

/** apply ?query params onto settings; returns null if no relevant params present */
export function settingsFromParams(q: URLSearchParams, base: Settings): Settings | null {
  let touched = false
  const s: Settings = { ...base, ascii: { ...base.ascii } }
  const num = (key: string, cb: (v: number) => void) => {
    const v = q.get(key)
    if (v !== null && !isNaN(Number(v))) {
      cb(Number(v))
      touched = true
    }
  }
  const mode = q.get('mode')
  if (mode && (MODES as string[]).includes(mode)) {
    s.mode = mode as Mode
    touched = true
  }
  num('seed', (v) => (s.seed = Math.floor(v)))
  // seed or mode given without explicit colors → derive a palette from them
  if (touched && !q.get('colors')) {
    s.colors = randomPalette(mulberry32(s.seed), s.mode)
  }
  num('grain', (v) => (s.grain = Math.min(1, Math.max(0, v))))
  const gtype = q.get('grainType')
  if (gtype && (GRAIN_TYPES as string[]).includes(gtype)) {
    s.grainType = gtype as GrainType
    touched = true
  }
  num('softness', (v) => (s.softness = Math.min(1, Math.max(0, v))))
  num('vignette', (v) => (s.vignette = Math.min(1, Math.max(0, v))))
  num('asciiSize', (v) => (s.ascii.size = Math.min(32, Math.max(7, v))))
  num('asciiOpacity', (v) => (s.ascii.opacity = Math.min(1, Math.max(0, v))))
  num('asciiDensity', (v) => (s.ascii.density = Math.min(1, Math.max(0, v))))
  num('asciiContrast', (v) => (s.ascii.contrast = Math.min(1, Math.max(0, v))))
  const aset = q.get('asciiSet')
  if (aset && (ASCII_SETS_UI as string[]).includes(aset)) {
    s.ascii.set = aset as AsciiSet
    touched = true
  }
  const style = q.get('style')
  if (style && ([...STYLES, 'image'] as string[]).includes(style)) {
    s.style = style as Style
    touched = true
  }
  const ascii = q.get('ascii')
  if (ascii !== null) {
    s.ascii.enabled = ascii === '1' || ascii === 'true'
    touched = true
  }
  const colors = q.get('colors')
  if (colors) {
    const list = colors
      .split(/[,-]/)
      .map((c) => c.trim().replace(/^#?/, '#'))
      .filter((c) => /^#[0-9a-fA-F]{6}$/.test(c) || /^#[0-9a-fA-F]{3}$/.test(c))
    if (list.length >= 2) {
      s.colors = list.slice(0, 6)
      touched = true
    }
  }
  const view = q.get('view')
  if (view) {
    const [x, y, sc] = view.split(',').map(Number)
    if ([x, y, sc].every((n) => isFinite(n))) {
      s.view = {
        x: Math.min(1.3, Math.max(-0.3, x)),
        y: Math.min(1.3, Math.max(-0.3, y)),
        s: Math.min(4, Math.max(0.25, sc)),
      }
      touched = true
    }
  }
  return touched ? s : null
}

const rnd = (v: number, p = 100) => Math.round(v * p) / p

/** serialize settings + ratio into a single shareable line */
export function encodeCode(s: Settings, ratio: number): string {
  const p: string[] = [
    `style=${s.style}`,
    `mode=${s.mode}`,
    `seed=${Math.floor(s.seed)}`,
    `colors=${s.colors.map((c) => c.replace('#', '')).join('-')}`,
    `ratio=${ratioParam(ratio)}`,
    `grain=${rnd(s.grain)}`,
    `grainType=${s.grainType ?? 'film'}`,
    `softness=${rnd(s.softness)}`,
    `vignette=${rnd(s.vignette)}`,
    `ascii=${s.ascii.enabled ? 1 : 0}`,
  ]
  if (s.ascii.enabled) {
    p.push(
      `asciiSet=${s.ascii.set ?? 'code'}`,
      `asciiSize=${Math.round(s.ascii.size)}`,
      `asciiOpacity=${rnd(s.ascii.opacity)}`,
      `asciiDensity=${rnd(s.ascii.density)}`,
      `asciiContrast=${rnd(s.ascii.contrast ?? 0.3)}`,
    )
  }
  const v = s.view
  if (v && (Math.abs(v.x - 0.5) > 0.002 || Math.abs(v.y - 0.5) > 0.002 || Math.abs(v.s - 1) > 0.002)) {
    p.push(`view=${rnd(v.x, 1000)},${rnd(v.y, 1000)},${rnd(v.s, 1000)}`)
  }
  return 'grainient:v1?' + p.join('&')
}

export interface DecodedGradient {
  settings: Settings
  /** null when the code doesn't specify one — keep whatever is current */
  ratio: number | null
}

/** pull the query-string payload out of a code, an app URL, or a bare query */
function extractQuery(input: string): string | null {
  let t = input.trim()
  if (!t) return null
  const qi = t.lastIndexOf('?')
  if (qi >= 0) t = t.slice(qi + 1)
  else t = t.replace(/^grainient(-page)?:v\d+[:\s]*/i, '')
  return t.includes('=') ? t : null
}

/** decode one gradient code / URL / query string; null if unrecognizable */
export function decodeCode(input: string): DecodedGradient | null {
  const query = extractQuery(input)
  if (!query) return null
  const q = new URLSearchParams(query)
  const seedRaw = Number(q.get('seed'))
  const base = baseSettings(isFinite(seedRaw) ? Math.floor(seedRaw) : 1)
  const settings = settingsFromParams(q, base)
  if (!settings) return null
  return { settings, ratio: parseRatio(q.get('ratio')) }
}

/** how far adjacent page sections cross-fade into each other (0 = hard edges) */
export const DEFAULT_BLEND = 0.25

export interface DecodedPage {
  sections: DecodedGradient[]
  blend: number
}

export function encodePageCode(
  sections: { settings: Settings; ratio: number }[],
  blend: number = DEFAULT_BLEND,
): string {
  return [
    `grainient-page:v1?blend=${rnd(Math.min(1, Math.max(0, blend)))}`,
    ...sections.map((s) => encodeCode(s.settings, s.ratio)),
  ].join('\n')
}

/**
 * Decode a page code (or any pasted pile of codes) into ordered sections.
 * Accepts one code per line, `section:`/`-` prefixed lines, and codes glued
 * together on one line. The header may carry page options (`…:v1?blend=0.3`).
 * A single gradient code decodes as a one-section page.
 */
export function decodePageCode(input: string): DecodedPage | null {
  let blend = DEFAULT_BLEND
  const parts = input
    .split(/\r?\n|(?=grainient:v\d+\?)/)
    .map((l) => l.trim().replace(/^(section:|-)\s*/i, ''))
    .filter((l) => {
      const header = l.match(/^grainient-page:v\d+(?:\?(.*))?$/i)
      if (header) {
        const b = new URLSearchParams(header[1] ?? '').get('blend')
        if (b !== null && !isNaN(Number(b))) blend = Math.min(1, Math.max(0, Number(b)))
        return false
      }
      return !!l && !l.startsWith('#') && !l.startsWith('//')
    })
  const decoded = parts.map(decodeCode).filter((d): d is DecodedGradient => d !== null)
  return decoded.length ? { sections: decoded, blend } : null
}
