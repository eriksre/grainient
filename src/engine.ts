// Gradient render engine: low-res color field → smooth upscale → film grain → ascii overlay.
// Everything is deterministic per seed so preview and PNG export match exactly.

export type Style = 'mesh' | 'waves' | 'beams' | 'spotlight' | 'linear' | 'radial' | 'image'

export type Mode = 'dark' | 'light' | 'mix'

export interface AsciiSettings {
  enabled: boolean
  size: number // cell size in 1/1000ths of canvas width, so exports scale correctly
  opacity: number // 0..1
  density: number // 0..1 fraction of cells that get a character
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
      // stacked soft ridges, like layered hills
      const order = shuffled(cols, rand)
      o.fillStyle = order[0]
      o.fillRect(0, 0, lw, lh)
      const rot = (rand() - 0.5) * 0.7
      const ext = maxDim
      o.save()
      o.translate(lw / 2, lh / 2)
      o.rotate(rot)
      o.translate(-lw / 2, -lh / 2)
      const n = order.length
      for (let i = 1; i < n; i++) {
        const yBase = (i / n) * lh * 1.15 - lh * 0.05 + (rand() - 0.5) * lh * 0.18
        const amp = (0.06 + rand() * 0.17) * lh
        const freq = ((0.7 + rand() * 1.8) * Math.PI * 2) / lw
        const phase = rand() * Math.PI * 2
        o.beginPath()
        o.moveTo(-ext, yBase + Math.sin(-ext * freq + phase) * amp)
        for (let x = -ext; x <= lw + ext; x += 1) {
          o.lineTo(x, yBase + Math.sin(x * freq + phase) * amp)
        }
        o.lineTo(lw + ext, lh + ext)
        o.lineTo(-ext, lh + ext)
        o.closePath()
        o.fillStyle = order[i]
        o.fill()
      }
      o.restore()
      // a soft glow where two bands meet
      const accent = order[Math.floor(rand() * n)]
      blob(accent, rand() * lw, rand() * lh, (0.3 + rand() * 0.3) * maxDim, 0.35)
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
      const fx = (0.2 + rand() * 0.6) * lw
      const fy = (0.2 + rand() * 0.6) * lh
      const g = o.createRadialGradient(fx, fy, 0, fx, fy, maxDim * (0.8 + rand() * 0.4))
      const order = shuffled(cols, rand)
      order.forEach((c, i) => g.addColorStop(i / (order.length - 1 || 1), c))
      o.fillStyle = g
      o.fillRect(0, 0, lw, lh)
      break
    }
  }
}

const RAMP = ' .:-=+xX8S#@'

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
  const rand = mulberry32((s.seed ^ 0x9e3779b9) >>> 0)

  // On dark images glyphs live in the light sections (and are lightened);
  // on light images that flips: glyphs live in the dark sections and are darkened.
  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
  }
  const lightBg = sum / (data.length / 4) > 128

  ctx.save()
  ctx.font = `${Math.round(cell * 0.95)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const keep = rand() <= s.ascii.density
      if (!keep) continue
      const i = (y * cols + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      const drive = lightBg ? 1 - lum : lum
      const idx = Math.min(RAMP.length - 1, Math.floor(drive * RAMP.length))
      const ch = RAMP[idx]
      if (ch === ' ') continue
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
      ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${s.ascii.opacity})`
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
