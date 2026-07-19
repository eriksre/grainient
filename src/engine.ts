// Gradient render engine: low-res color field → smooth upscale → film grain → ascii overlay.
// Everything is deterministic per seed so preview and PNG export match exactly.

export type Style =
  | 'mesh'
  | 'bloom'
  | 'rise'
  | 'set'
  | 'waves'
  | 'horizon'
  | 'beams'
  | 'spotlight'
  | 'linear'
  | 'radial'
  | 'image'

export type Mode = 'dark' | 'light' | 'mix'

export type AsciiSet = 'classic' | 'code' | 'dots' | 'heavy'

export interface AsciiSettings {
  enabled: boolean
  size: number // cell size in 1/1000ths of canvas width, so exports scale correctly
  opacity: number // 0..1
  density: number // 0..1 how deep into the mid-tones glyphs reach
  contrast?: number // 0..1 S-curve on the tonal drive; 0.2 ≈ neutral
  set?: AsciiSet // glyph vocabulary
}

export interface Settings {
  seed: number
  style: Style
  mode: Mode
  colors: string[]
  grain: number // 0..1
  softness: number // 0..1
  vignette: number // 0..1
  ascii: AsciiSettings
}

export function mulberry32(a: number) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

export function hslHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255)
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function saturation(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

function shuffled<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// --- grain tile (built once, reused) ---
let noiseTile: HTMLCanvasElement | null = null
function getNoise(): HTMLCanvasElement {
  if (noiseTile) return noiseTile
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(256, 256)
  const rand = mulberry32(0xc0ffee)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(rand() * 256)
    img.data[i] = v
    img.data[i + 1] = v
    img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  noiseTile = c
  return c
}

/** darkest or lightest palette color depending on mode ('mix' flips a seeded coin) */
function anchor(cols: string[], mode: Mode, rand: () => number): string {
  const sorted = [...cols].sort((a, b) => luminance(a) - luminance(b))
  if (mode === 'light') return sorted[sorted.length - 1]
  if (mode === 'dark') return sorted[0]
  return rand() < 0.5 ? sorted[0] : sorted[sorted.length - 1]
}

function paintField(
  o: CanvasRenderingContext2D,
  lw: number,
  lh: number,
  s: Settings,
  rand: () => number,
  imageField: HTMLCanvasElement | null,
) {
  const cols = s.colors.length ? s.colors : ['#1a1a2e', '#7b6cff']
  const maxDim = Math.max(lw, lh)

  const blob = (color: string, x: number, y: number, r: number, alpha = 1) => {
    const [cr, cg, cb] = hexToRgb(color)
    const g = o.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha})`)
    g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
    o.fillStyle = g
    o.fillRect(0, 0, lw, lh)
  }

  // 'image' with no image loaded falls back to mesh
  const style: Style = s.style === 'image' && !imageField ? 'mesh' : s.style

  switch (style) {
    case 'image': {
      const img = imageField!
      const k = Math.max(lw / img.width, lh / img.height)
      const dw = img.width * k
      const dh = img.height * k
      o.drawImage(img, (lw - dw) / 2, (lh - dh) / 2, dw, dh)
      break
    }
    case 'mesh': {
      o.fillStyle = anchor(cols, s.mode, rand)
      o.fillRect(0, 0, lw, lh)
      const blobs: { c: string; x: number; y: number; r: number }[] = []
      for (const c of cols) {
        const n = rand() < 0.45 ? 2 : 1
        for (let i = 0; i < n; i++) {
          blobs.push({
            c,
            x: (rand() * 1.4 - 0.2) * lw,
            y: (rand() * 1.4 - 0.2) * lh,
            r: (0.35 + rand() * 0.55) * maxDim,
          })
        }
      }
      for (const b of shuffled(blobs, rand)) blob(b.c, b.x, b.y, b.r)
      break
    }
    case 'waves': {
      // stacked soft ridges, like layered hills — each band's fill fades into the next
      const order = shuffled(cols, rand)
      o.fillStyle = order[0]
      o.fillRect(0, 0, lw, lh)
      const rot = (rand() - 0.5) * 0.7
      const ext = maxDim
      const n = order.length
      const bands: { c: string; yBase: number; amp: number; freq: number; phase: number }[] = []
      for (let i = 1; i < n; i++) {
        bands.push({
          c: order[i],
          yBase: (i / n) * lh * 1.15 - lh * 0.05 + (rand() - 0.5) * lh * 0.18,
          amp: (0.04 + rand() * 0.12) * lh,
          freq: ((0.6 + rand() * 1.4) * Math.PI * 2) / lw,
          phase: rand() * Math.PI * 2,
        })
      }
      bands.sort((a, b) => a.yBase - b.yBase)
      o.save()
      o.translate(lw / 2, lh / 2)
      o.rotate(rot)
      o.translate(-lw / 2, -lh / 2)
      for (let i = 0; i < bands.length; i++) {
        const b = bands[i]
        const nextY = i + 1 < bands.length ? bands[i + 1].yBase : lh + ext
        const nextC = i + 1 < bands.length ? bands[i + 1].c : b.c
        const g = o.createLinearGradient(0, b.yBase, 0, Math.max(b.yBase + 2, nextY))
        g.addColorStop(0, b.c)
        g.addColorStop(1, nextC)
        o.beginPath()
        o.moveTo(-ext, b.yBase + Math.sin(-ext * b.freq + b.phase) * b.amp)
        for (let x = -ext; x <= lw + ext; x += 1) {
          o.lineTo(x, b.yBase + Math.sin(x * b.freq + b.phase) * b.amp)
        }
        o.lineTo(lw + ext, lh + ext)
        o.lineTo(-ext, lh + ext)
        o.closePath()
        o.fillStyle = g
        o.fill()
      }
      o.restore()
      break
    }
    case 'bloom': {
      // composed corner glows over an anchor field
      o.fillStyle = anchor(cols, s.mode, rand)
      o.fillRect(0, 0, lw, lh)
      const corners: [number, number][] = shuffled(
        [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ],
        rand,
      )
      const order = shuffled(cols, rand)
      const count = Math.min(order.length, 2 + Math.floor(rand() * 2))
      for (let i = 0; i < count; i++) {
        const [cx, cy] = corners[i]
        blob(
          order[i],
          (cx + (rand() - 0.5) * 0.3) * lw,
          (cy + (rand() - 0.5) * 0.3) * lh,
          (0.55 + rand() * 0.45) * maxDim,
        )
      }
      if (rand() < 0.5) {
        blob(order[count % order.length], (0.35 + rand() * 0.3) * lw, (0.35 + rand() * 0.3) * lh, 0.5 * maxDim, 0.35)
      }
      break
    }
    case 'rise':
    case 'set': {
      // a radial dome anchored to the bottom (rise) or top (set) edge —
      // varied position, width, squash, and layered stops
      const bgc = anchor(cols, s.mode, rand)
      o.fillStyle = bgc
      o.fillRect(0, 0, lw, lh)
      const bgL = luminance(bgc)
      const rest = cols.filter((c) => c !== bgc)
      // core = strongest contrast against the field, melting outward toward it
      rest.sort((a, b) => Math.abs(luminance(b) - bgL) - Math.abs(luminance(a) - bgL))
      const ring = rest.length ? [...rest.slice(0, 3), bgc] : [bgc, bgc]
      const isRise = style === 'rise'
      const cx = lw / 2 // always centered — variety comes from shape, size, and squash
      const edge = rand() * 0.18 // how far past the edge the center sits
      const cy = isRise ? lh * (1 + edge) : -lh * edge
      const squashX = 0.9 + rand() * 1.6
      const squashY = 0.5 + rand() * 0.75
      const R = maxDim * (0.55 + rand() * 0.6)
      // the outermost stop fades to transparent so the dome melts into the field
      // with no rectangular seams from the fill area's edges
      const paintDome = (y: number, sx: number, sy: number, r: number, alpha: number) => {
        o.save()
        o.translate(cx, y)
        o.scale(sx, sy)
        const g = o.createRadialGradient(0, 0, 0, 0, 0, r)
        ring.forEach((c, i) => {
          const last = i === ring.length - 1
          const t = i / (ring.length - 1)
          const jitter = i === 0 || last ? 0 : (rand() - 0.5) * 0.08
          const [cr, cg, cb] = hexToRgb(c)
          g.addColorStop(Math.min(1, Math.max(0, t + jitter)), `rgba(${cr},${cg},${cb},${last ? 0 : alpha})`)
        })
        o.fillStyle = g
        const cover = r * 1.1
        o.fillRect(-cover, -cover, cover * 2, cover * 2)
        o.restore()
      }
      paintDome(cy, squashX, squashY, R, 1)
      // occasional inner halo for extra depth, concentric with the main dome
      if (rand() < 0.4 && rest.length > 1) {
        paintDome(cy, squashX * (0.55 + rand() * 0.4), squashY * (0.6 + rand() * 0.5), R * (0.4 + rand() * 0.3), 0.55)
      }
      break
    }
    case 'horizon': {
      // soft strata with a squashed glow near the brightest edge
      const byLum = [...cols].sort((a, b) => luminance(a) - luminance(b))
      const brightBottom = rand() < 0.5
      const order = brightBottom ? byLum : [...byLum].reverse()
      const g = o.createLinearGradient(0, 0, 0, lh)
      order.forEach((c, i) => {
        const t = i / (order.length - 1 || 1)
        const jitter = i === 0 || i === order.length - 1 ? 0 : (rand() - 0.5) * 0.15
        g.addColorStop(Math.min(1, Math.max(0, t + jitter)), c)
      })
      o.fillStyle = g
      o.fillRect(0, 0, lw, lh)
      const bright = byLum[byLum.length - 1]
      const [br, bg2, bb] = hexToRgb(bright)
      const gy = brightBottom ? lh * (0.72 + rand() * 0.2) : lh * (0.08 + rand() * 0.2)
      o.save()
      o.translate((0.2 + rand() * 0.6) * lw, gy)
      o.scale(1, 0.45 + rand() * 0.3)
      const R = maxDim * (0.4 + rand() * 0.3)
      const glow = o.createRadialGradient(0, 0, 0, 0, 0, R)
      glow.addColorStop(
        0,
        `rgba(${Math.min(255, br + 60)},${Math.min(255, bg2 + 60)},${Math.min(255, bb + 60)},0.9)`,
      )
      glow.addColorStop(1, `rgba(${br},${bg2},${bb},0)`)
      o.fillStyle = glow
      o.fillRect(-R, -R, R * 2, R * 2)
      o.restore()
      break
    }
    case 'beams': {
      // long diagonal streaks sharing one dominant direction, like light through glass
      o.fillStyle = anchor(cols, s.mode, rand)
      o.fillRect(0, 0, lw, lh)
      const theta = rand() * Math.PI
      const streaks: { c: string; x: number; y: number; r: number; a: number; st: number }[] = []
      for (const c of cols) {
        const n = rand() < 0.5 ? 2 : 1
        for (let i = 0; i < n; i++) {
          streaks.push({
            c,
            x: (rand() * 1.2 - 0.1) * lw,
            y: (rand() * 1.2 - 0.1) * lh,
            r: (0.12 + rand() * 0.28) * maxDim,
            a: theta + (rand() - 0.5) * 0.4,
            st: 2.5 + rand() * 3.5,
          })
        }
      }
      for (const b of shuffled(streaks, rand)) {
        const [cr, cg, cb] = hexToRgb(b.c)
        o.save()
        o.translate(b.x, b.y)
        o.rotate(b.a)
        o.scale(1, b.st)
        const g = o.createRadialGradient(0, 0, 0, 0, 0, b.r)
        g.addColorStop(0, `rgba(${cr},${cg},${cb},1)`)
        g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
        o.fillStyle = g
        o.fillRect(-b.r, -b.r, b.r * 2, b.r * 2)
        o.restore()
      }
      break
    }
    case 'spotlight': {
      // near-black stage with one or two hot horizontal-ish beams
      const sorted = [...cols].sort((a, b) => luminance(a) - luminance(b))
      const [dr, dg, db] = hexToRgb(sorted[0])
      o.fillStyle = rgbToHex(dr * 0.25, dg * 0.25, db * 0.25)
      o.fillRect(0, 0, lw, lh)
      const bright = sorted.slice(-2)
      const nBeams = rand() < 0.4 && bright.length > 1 ? 2 : 1
      for (let i = 0; i < nBeams; i++) {
        const c = bright[bright.length - 1 - i]
        const [cr, cg, cb] = hexToRgb(c)
        const cx = (0.3 + rand() * 0.4) * lw
        const cy = (0.25 + rand() * 0.5) * lh
        const th = (rand() - 0.5) * 0.5
        const squash = 0.1 + rand() * 0.22
        const r = maxDim * (0.7 + rand() * 0.5)
        o.save()
        o.translate(cx, cy)
        o.rotate(th)
        o.scale(1, squash)
        const g = o.createRadialGradient(0, 0, 0, 0, 0, r)
        const hr = cr + (255 - cr) * 0.8
        const hg = cg + (255 - cg) * 0.8
        const hb = cb + (255 - cb) * 0.8
        g.addColorStop(0, `rgba(${hr | 0},${hg | 0},${hb | 0},1)`)
        g.addColorStop(0.35, `rgba(${cr},${cg},${cb},0.9)`)
        g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
        o.fillStyle = g
        o.fillRect(-r, -r, r * 2, r * 2)
        o.restore()
      }
      break
    }
    case 'linear': {
      const ang = rand() * Math.PI * 2
      const cx = lw / 2
      const cy = lh / 2
      const dx = (Math.cos(ang) * maxDim) / 2
      const dy = (Math.sin(ang) * maxDim) / 2
      const g = o.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
      const order = shuffled(cols, rand)
      const stops = order.map((_, i) => {
        if (i === 0) return 0
        if (i === order.length - 1) return 1
        const t = i / (order.length - 1)
        return Math.min(0.95, Math.max(0.05, t + (rand() - 0.5) * 0.25))
      }).sort((a, b) => a - b)
      order.forEach((c, i) => g.addColorStop(stops[i], c))
      o.fillStyle = g
      o.fillRect(0, 0, lw, lh)
      // one soft accent so it isn't perfectly flat
      const accent = order[Math.floor(rand() * order.length)]
      blob(accent, rand() * lw, rand() * lh, (0.4 + rand() * 0.4) * maxDim, 0.45)
      break
    }
    case 'radial': {
      // tasteful glow: monotonic luminance from a bright core out to the darkest rim,
      // so clashing hues never form alternating rings
      const byLum = [...cols].sort((a, b) => luminance(b) - luminance(a))
      const avg = cols.reduce((t, c) => t + luminance(c), 0) / cols.length
      const light = s.mode === 'light' || (s.mode === 'mix' && avg > 140)
      let order: string[]
      if (light) {
        // light fields read best with a saturated core melting into paler tones
        const core = [...cols].sort((a, b) => saturation(b) - saturation(a))[0]
        order = [core, ...byLum.filter((c) => c !== core)]
      } else {
        order = byLum
      }
      if (order.length > 4) {
        order = [order[0], order[1], order[order.length - 2], order[order.length - 1]]
      }
      const fx = (0.2 + rand() * 0.6) * lw
      const fy = (0.2 + rand() * 0.6) * lh
      const g = o.createRadialGradient(fx, fy, 0, fx, fy, maxDim * (0.85 + rand() * 0.4))
      order.forEach((c, i) => {
        const t = i / (order.length - 1 || 1)
        const jitter = i === 0 || i === order.length - 1 ? 0 : (rand() - 0.5) * 0.12
        g.addColorStop(Math.min(1, Math.max(0, t + jitter)), c)
      })
      o.fillStyle = g
      o.fillRect(0, 0, lw, lh)
      break
    }
  }
}

// Glyph vocabularies: each brightness class is a POOL of glyphs with similar ink
// weight, so a tonal band reads as one texture but never repeats a single character.
// Ordered weak → strong.
const ASCII_SETS: Record<AsciiSet, string[][]> = {
  classic: [['.'], [':'], ['-', '~'], ['=', '+'], ['x', '*'], ['X', 'S'], ['8', '0'], ['#', '&'], ['@']],
  code: [
    ['.', ','],
    [':', ';', "'"],
    ['!', 'i', '|', '('],
    ['=', '?', '+', '{'],
    ['x', 'c', 'v', 'z'],
    ['X', 'V', 'U', '$'],
    ['8', 'S', 'K', '0'],
    ['#', 'W', '&'],
    ['@'],
  ],
  dots: [['.'], ['.'], [':'], [':'], ['+'], ['o'], ['*'], ['O'], ['@']],
  heavy: [['.'], [':'], ['='], ['x'], ['X'], ['8'], ['#'], ['M'], ['@']],
}

// deterministic per-cell hash so glyph choice is stable across re-renders and exports
function cellHash(x: number, y: number, seed: number): number {
  let n = (x * 73856093) ^ (y * 19349663) ^ (seed | 0)
  n = Math.imul(n ^ (n >>> 13), 0x5bd1e995)
  return (n ^ (n >>> 15)) >>> 0
}

// 8×8 Bayer matrix: ordered dithering makes glyph placement follow the image's
// tonal structure instead of scattering randomly
const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
]

function drawAscii(ctx: CanvasRenderingContext2D, w: number, h: number, s: Settings) {
  const cell = Math.max(5, Math.round((s.ascii.size / 1000) * w))
  const cols = Math.ceil(w / cell)
  const rows = Math.ceil(h / cell)
  const tiny = document.createElement('canvas')
  tiny.width = cols
  tiny.height = rows
  const t = tiny.getContext('2d')!
  t.drawImage(ctx.canvas, 0, 0, cols, rows)
  const data = t.getImageData(0, 0, cols, rows).data

  // On dark images glyphs live in the light sections (and are lightened);
  // on light images that flips: glyphs live in the dark sections and are darkened.
  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
  }
  const lightBg = sum / (data.length / 4) > 128

  const pools = ASCII_SETS[s.ascii.set ?? 'code'] ?? ASCII_SETS.code
  // S-curve contrast on the tonal drive: higher values carve crisper bands
  const k = 0.5 + (s.ascii.contrast ?? 0.2) * 2.5

  ctx.save()
  ctx.font = `${Math.round(cell * 0.95)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      let drive = lightBg ? 1 - lum : lum
      drive = Math.min(1, Math.max(0, 0.5 + (drive - 0.5) * k))
      // ordered dither: strong tones always earn a glyph, mid tones form
      // structured contour bands, weak tones stay clean
      const threshold = BAYER8[y % 8][x % 8] / 64
      if (drive * (0.25 + s.ascii.density * 0.95) <= threshold) continue
      const pool = pools[Math.min(pools.length - 1, Math.floor(drive * pools.length))]
      const ch = pool[cellHash(x, y, s.seed) % pool.length]
      let cr: number, cg: number, cb: number
      if (lightBg) {
        cr = r * 0.4
        cg = g * 0.4
        cb = b * 0.4
      } else {
        cr = r + (255 - r) * 0.6
        cg = g + (255 - g) * 0.6
        cb = b + (255 - b) * 0.6
      }
      // stronger tones print with more ink — adds depth inside a band
      const alpha = s.ascii.opacity * (0.45 + 0.55 * drive)
      ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${alpha})`
      ctx.fillText(ch, x * cell + cell / 2, y * cell + cell / 2)
    }
  }
  ctx.restore()
}

export function renderGradient(
  canvas: HTMLCanvasElement,
  s: Settings,
  w: number,
  h: number,
  imageField: HTMLCanvasElement | null = null,
) {
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const rand = mulberry32(s.seed)

  // 1. paint the color field at low resolution — upscaling does the blurring for free
  const long = Math.max(w, h)
  const lowLong = Math.round(22 + (1 - s.softness) * 150)
  const k = lowLong / long
  const lw = Math.max(6, Math.round(w * k))
  const lh = Math.max(6, Math.round(h * k))
  const off = document.createElement('canvas')
  off.width = lw
  off.height = lh
  paintField(off.getContext('2d')!, lw, lh, s, rand, imageField)

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(off, 0, 0, w, h)

  // 2. film grain
  if (s.grain > 0) {
    const pat = ctx.createPattern(getNoise(), 'repeat')!
    const gs = Math.max(1, w / 1600)
    pat.setTransform(new DOMMatrix().scale(gs))
    ctx.save()
    ctx.fillStyle = pat
    ctx.globalCompositeOperation = 'overlay'
    ctx.globalAlpha = Math.min(1, s.grain * 0.85)
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'soft-light'
    ctx.globalAlpha = Math.min(1, s.grain * 0.5)
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }

  // 3. vignette
  if (s.vignette > 0) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(0,0,0,${0.55 * s.vignette})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // 4. ascii lettering
  if (s.ascii.enabled) drawAscii(ctx, w, h, s)
}
