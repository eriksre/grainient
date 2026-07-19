import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_VIEW,
  mulberry32,
  renderGradient,
  VIEW_MAX_SCALE,
  VIEW_MIN_SCALE,
  type AsciiSet,
  type GrainType,
  type Mode,
  type Settings,
  type Style,
  type ViewTransform,
} from './engine'
import { importImage, importImageUrl, randomPalette } from './palette'

const RATIOS: [string, number][] = [
  ['21:9', 21 / 9],
  ['16:9', 16 / 9],
  ['3:2', 3 / 2],
  ['1:1', 1],
  ['4:5', 4 / 5],
  ['9:16', 9 / 16],
]

const STYLES: Style[] = ['mesh', 'bloom', 'rise', 'set', 'waves', 'horizon', 'beams', 'spotlight', 'linear', 'radial']
const MODES: Mode[] = ['dark', 'light', 'mix']
const ASCII_SETS_UI: AsciiSet[] = ['classic', 'code', 'dots', 'heavy']
const GRAIN_TYPES: GrainType[] = ['film', 'coarse', 'pixel', 'dither']

export type Format = 'png' | 'jpg' | 'webp'
const FORMATS: Format[] = ['png', 'jpg', 'webp']
const MIME: Record<Format, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }

const PREVIEW_LONG = 1440
const EXPORT_LONG = 2880

const newSeed = () => Math.floor(Math.random() * 2 ** 31)

function makeInitial(): Settings {
  const seed = newSeed()
  return {
    seed,
    style: 'mesh',
    mode: 'mix',
    colors: randomPalette(mulberry32(seed), 'mix'),
    grain: 0.49,
    grainType: 'film',
    softness: 0.45,
    vignette: 0.12,
    ascii: { enabled: true, size: 11, opacity: 0.67, density: 0.51, contrast: 0.3, set: 'code' },
  }
}

function dims(ratio: number, long: number): [number, number] {
  return ratio >= 1 ? [long, Math.round(long / ratio)] : [Math.round(long * ratio), long]
}

function parseRatio(v: string | null): number | null {
  if (!v) return null
  const m = v.match(/^(\d+(?:\.\d+)?)[:x/](\d+(?:\.\d+)?)$/)
  if (!m) return null
  const r = Number(m[1]) / Number(m[2])
  return isFinite(r) && r > 0 ? r : null
}

/** apply ?query params onto settings; returns null if no relevant params present */
function settingsFromParams(q: URLSearchParams, base: Settings): Settings | null {
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
  return touched ? s : null
}

function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="slider">
      <div className="slider-head">
        <span>{label}</span>
        <span className="slider-val">{max <= 1 ? Math.round(value * 100) : Math.round(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

interface Snapshot {
  settings: Settings
  ratio: number
}

interface LibItem {
  id: string
  ts: number
  settings: Settings
  ratio: number
  thumb: string
  image?: string
}

const LIB_KEY = 'grainient.library.v1'

function readLibrary(): LibItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LIB_KEY) ?? '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

/** canonical identity of a gradient — used to prevent duplicate saves */
function gradKey(s: Settings, ratio: number): string {
  return JSON.stringify([
    s.seed,
    s.style,
    s.mode,
    s.colors,
    s.grain,
    s.grainType ?? 'film',
    s.softness,
    s.vignette,
    s.ascii.enabled,
    s.ascii.size,
    s.ascii.opacity,
    s.ascii.density,
    s.ascii.contrast ?? 0.3,
    s.ascii.set ?? 'code',
    Math.round(ratio * 1000),
    Math.round((s.view?.x ?? 0.5) * 1000),
    Math.round((s.view?.y ?? 0.5) * 1000),
    Math.round((s.view?.s ?? 1) * 1000),
  ])
}

function clampView(v: ViewTransform): ViewTransform {
  return {
    x: Math.min(1.3, Math.max(-0.3, v.x)),
    y: Math.min(1.3, Math.max(-0.3, v.y)),
    s: Math.min(VIEW_MAX_SCALE, Math.max(VIEW_MIN_SCALE, v.s)),
  }
}

/** zoom about a point u (0..1 frame coords) keeping it visually fixed */
function zoomAt(v: ViewTransform, ux: number, uy: number, factor: number): ViewTransform {
  const s2 = Math.min(VIEW_MAX_SCALE, Math.max(VIEW_MIN_SCALE, v.s * factor))
  return {
    x: v.x + (ux - 0.5) * (1 / v.s - 1 / s2),
    y: v.y + (uy - 0.5) * (1 / v.s - 1 / s2),
    s: s2,
  }
}

function normalizeHex(v: string): string | null {
  let t = v.trim()
  if (!t.startsWith('#')) t = '#' + t
  if (/^#[0-9a-fA-F]{3}$/.test(t)) {
    t = '#' + t.slice(1).split('').map((c) => c + c).join('')
  }
  return /^#[0-9a-fA-F]{6}$/.test(t) ? t.toLowerCase() : null
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(makeInitial)
  const [ratio, setRatio] = useState(16 / 9)
  const [format, setFormat] = useState<Format>('webp')
  const [dragging, setDragging] = useState(false)
  const [imageField, setImageField] = useState<HTMLCanvasElement | null>(null)
  const [histLen, setHistLen] = useState(0)
  const [library, setLibrary] = useState<LibItem[]>(readLibrary)
  const [selIdx, setSelIdx] = useState(0)
  const [hexDraft, setHexDraft] = useState('')
  const [dlOpen, setDlOpen] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('grainient.theme') === 'light' ? 'light' : 'dark',
  )
  const dlRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [panning, setPanning] = useState(false)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchDistRef = useRef(0)
  const viewRafRef = useRef(0)
  const pendingViewRef = useRef<ViewTransform | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [fit, setFit] = useState({ w: 800, h: 450 })

  // refs so the imperative agent API + history always see current state
  const stateRef = useRef({ settings, ratio, imageField, format })
  useEffect(() => {
    stateRef.current = { settings, ratio, imageField, format }
  })

  const historyRef = useRef<Snapshot[]>([])
  const futureRef = useRef<Snapshot[]>([])
  const snap = useCallback(
    (): Snapshot => ({
      settings: JSON.parse(JSON.stringify(stateRef.current.settings)),
      ratio: stateRef.current.ratio,
    }),
    [],
  )

  // called before every divergent action — a new branch invalidates the redo queue
  const pushHistory = useCallback(() => {
    historyRef.current.push(snap())
    if (historyRef.current.length > 100) historyRef.current.shift()
    futureRef.current = []
    setHistLen(historyRef.current.length)
  }, [snap])

  const applySnap = useCallback((s: Snapshot) => {
    setSettings(s.settings)
    setRatio(s.ratio)
  }, [])

  const back = useCallback(() => {
    const prev = historyRef.current.pop()
    if (!prev) return
    futureRef.current.push(snap())
    setHistLen(historyRef.current.length)
    applySnap(prev)
  }, [snap, applySnap])

  const patch = (p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p }))
  const patchAscii = (p: Partial<Settings['ascii']>) =>
    setSettings((s) => ({ ...s, ascii: { ...s.ascii, ...p } }))

  // --- canvas pan/zoom: rAF-throttled so drags render once per frame ---
  const scheduleView = useCallback((mutate: (v: ViewTransform) => ViewTransform) => {
    const base = pendingViewRef.current ?? { ...(stateRef.current.settings.view ?? DEFAULT_VIEW) }
    pendingViewRef.current = clampView(mutate(base))
    if (!viewRafRef.current) {
      viewRafRef.current = requestAnimationFrame(() => {
        viewRafRef.current = 0
        const v = pendingViewRef.current
        pendingViewRef.current = null
        if (v) setSettings((s) => ({ ...s, view: v }))
      })
    }
  }, [])

  const resetView = useCallback(() => {
    pendingViewRef.current = null
    setSettings((s) => ({ ...s, view: undefined }))
  }, [])

  const onCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()]
      pinchDistRef.current = Math.hypot(a.x - b.x, a.y - b.y)
    }
    setPanning(true)
  }

  const onCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pointersRef.current.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY
    const rect = e.currentTarget.getBoundingClientRect()
    const pts = [...pointersRef.current.values()]
    if (pts.length === 1) {
      // one finger / mouse drag: the content follows the pointer
      scheduleView((v) => ({ ...v, x: v.x - dx / rect.width / v.s, y: v.y - dy / rect.height / v.s }))
    } else if (pts.length === 2) {
      // pinch: zoom about the midpoint, pan with it
      const [a, b] = pts
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const ratio = pinchDistRef.current > 0 ? dist / pinchDistRef.current : 1
      pinchDistRef.current = dist
      const ux = ((a.x + b.x) / 2 - rect.left) / rect.width
      const uy = ((a.y + b.y) / 2 - rect.top) / rect.height
      scheduleView((v) => {
        const panned = { ...v, x: v.x - dx / 2 / rect.width / v.s, y: v.y - dy / 2 / rect.height / v.s }
        return zoomAt(panned, ux, uy, ratio)
      })
    }
  }

  const onCanvasPointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size < 2) pinchDistRef.current = 0
    if (pointersRef.current.size === 0) setPanning(false)
  }

  // trackpad/wheel: scroll pans, pinch or ⌘/ctrl-scroll zooms at the cursor
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = c.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        const ux = (e.clientX - rect.left) / rect.width
        const uy = (e.clientY - rect.top) / rect.height
        scheduleView((v) => zoomAt(v, ux, uy, Math.exp(-e.deltaY * 0.01)))
      } else {
        scheduleView((v) => ({
          ...v,
          x: v.x + e.deltaX / rect.width / v.s,
          y: v.y + e.deltaY / rect.height / v.s,
        }))
      }
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    return () => c.removeEventListener('wheel', onWheel)
  }, [scheduleView])

  const lucky = useCallback(() => {
    pushHistory()
    const seed = newSeed()
    setSettings((s) => ({ ...s, seed, colors: randomPalette(mulberry32(seed), s.mode), view: undefined }))
  }, [pushHistory])

  // → replays gradients you backed out of; only rolls a fresh lucky once the
  // redo queue is exhausted
  const forward = useCallback(() => {
    const next = futureRef.current.pop()
    if (next) {
      historyRef.current.push(snap())
      setHistLen(historyRef.current.length)
      applySnap(next)
    } else {
      lucky()
    }
  }, [snap, applySnap, lucky])

  const shuffle = useCallback(() => {
    pushHistory()
    setSettings((s) => ({ ...s, seed: newSeed(), view: undefined }))
  }, [pushHistory])

  const setStyle = useCallback(
    (style: Style) => {
      pushHistory()
      setSettings((s) => ({ ...s, style }))
    },
    [pushHistory],
  )

  const setMode = useCallback(
    (mode: Mode) => {
      pushHistory()
      const seed = newSeed()
      setSettings((s) => ({ ...s, mode, seed, colors: randomPalette(mulberry32(seed), mode) }))
    },
    [pushHistory],
  )

  // fit the canvas inside the stage while keeping the chosen ratio
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => {
      const cs = getComputedStyle(el)
      const cw = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const ch = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      let w = cw
      let h = w / ratio
      if (h > ch) {
        h = ch
        w = h * ratio
      }
      setFit({ w: Math.max(60, Math.floor(w)), h: Math.max(60, Math.floor(h)) })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [ratio])

  // render
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const [w, h] = dims(ratio, PREVIEW_LONG)
    renderGradient(c, settings, w, h, imageField)
  }, [settings, ratio, imageField])

  // space / → = lucky (→ replays the redo queue first), ⌫ / ← = back.
  // Buttons keep focus after a click, so shortcuts must still fire when a button
  // is focused — only text entry and sliders keep their native key handling.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      if (e.code === 'Space') {
        e.preventDefault()
        lucky()
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        forward()
      } else if (e.code === 'Backspace' || e.code === 'ArrowLeft') {
        e.preventDefault()
        back()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lucky, back, forward])

  const onFiles = useCallback(
    async (files: FileList | null) => {
      const f = files?.[0]
      if (!f || !f.type.startsWith('image/')) return
      try {
        const { colors, field } = await importImage(f)
        if (colors.length >= 2) {
          pushHistory()
          setImageField(field)
          setSettings((s) => ({ ...s, colors, seed: newSeed(), style: 'image' }))
        }
      } catch (err) {
        console.error('image import failed', err)
      }
    },
    [pushHistory],
  )

  // window-level drag & drop
  useEffect(() => {
    let depth = 0
    const over = (e: DragEvent) => {
      e.preventDefault()
    }
    const enter = (e: DragEvent) => {
      e.preventDefault()
      depth++
      if (e.dataTransfer?.types.includes('Files')) setDragging(true)
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const drop = (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setDragging(false)
      onFiles(e.dataTransfer?.files ?? null)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [onFiles])

  const exportDataURL = useCallback((fmt: Format = 'png', long = EXPORT_LONG): string => {
    const { settings, ratio, imageField } = stateRef.current
    const [w, h] = dims(ratio, long)
    const c = document.createElement('canvas')
    renderGradient(c, settings, w, h, imageField)
    return c.toDataURL(MIME[fmt], 0.92)
  }, [])

  const download = useCallback(
    (fmt?: Format) => {
      const f = fmt && FORMATS.includes(fmt) ? fmt : stateRef.current.format
      const url = exportDataURL(f)
      const a = document.createElement('a')
      a.href = url
      const r = stateRef.current.ratio
      const rName = (RATIOS.find(([, rr]) => Math.abs(r - rr) < 0.001)?.[0] ?? r.toFixed(2)).replace(':', 'x')
      a.download = `grainient-${stateRef.current.settings.seed}-${rName}.${f}`
      a.click()
    },
    [exportDataURL],
  )

  // --- saved library (localStorage) ---
  const persistLib = useCallback((update: (prev: LibItem[]) => LibItem[]) => {
    setLibrary((prev) => {
      const next = update(prev)
      try {
        localStorage.setItem(LIB_KEY, JSON.stringify(next))
      } catch (e) {
        console.error('library save failed', e)
      }
      return next
    })
  }, [])

  const saveToLibrary = useCallback(() => {
    const { settings, ratio, imageField } = stateRef.current
    const [w, h] = dims(ratio, 320)
    const c = document.createElement('canvas')
    renderGradient(c, settings, w, h, imageField)
    const item: LibItem = {
      id: Math.random().toString(36).slice(2),
      ts: Date.now(),
      settings: JSON.parse(JSON.stringify(settings)),
      ratio,
      thumb: c.toDataURL('image/jpeg', 0.7),
    }
    if (settings.style === 'image' && imageField) item.image = imageField.toDataURL('image/jpeg', 0.85)
    persistLib((prev) => [item, ...prev].slice(0, 40))
  }, [persistLib])

  const loadFromLibrary = useCallback(
    (item: LibItem) => {
      pushHistory()
      if (item.image) {
        const img = new Image()
        img.onload = () => {
          const c = document.createElement('canvas')
          c.width = img.naturalWidth
          c.height = img.naturalHeight
          c.getContext('2d')!.drawImage(img, 0, 0)
          setImageField(c)
        }
        img.src = item.image
      }
      setSettings(JSON.parse(JSON.stringify(item.settings)))
      setRatio(item.ratio)
    },
    [pushHistory],
  )

  const deleteFromLibrary = useCallback(
    (id: string) => persistLib((prev) => prev.filter((it) => it.id !== id)),
    [persistLib],
  )

  // bookmark is a saved-state toggle: identical gradients can't be saved twice,
  // clicking while saved removes it
  const isSaved = library.some((it) => gradKey(it.settings, it.ratio) === gradKey(settings, ratio))
  const toggleSave = useCallback(() => {
    const key = gradKey(stateRef.current.settings, stateRef.current.ratio)
    const existing = library.find((it) => gradKey(it.settings, it.ratio) === key)
    if (existing) deleteFromLibrary(existing.id)
    else saveToLibrary()
  }, [library, deleteFromLibrary, saveToLibrary])

  // site theme
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('grainient.theme', theme)
  }, [theme])

  // close the download format menu on outside click
  useEffect(() => {
    if (!dlOpen) return
    const close = (e: MouseEvent) => {
      if (!dlRef.current?.contains(e.target as Node)) setDlOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [dlOpen])

  // agent API part 1: URL params on load
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const fmt = q.get('format') ?? q.get('download')
    if (fmt && (FORMATS as string[]).includes(fmt)) setFormat(fmt as Format)
    const r = parseRatio(q.get('ratio'))
    if (r) setRatio(r)
    const fromParams = settingsFromParams(q, stateRef.current.settings)
    if (fromParams) setSettings(fromParams)
    const img = q.get('image')
    if (img) {
      importImageUrl(img)
        .then(({ colors, field }) => {
          setImageField(field)
          setSettings((s) => ({
            ...s,
            colors,
            style: q.get('style') && q.get('style') !== 'image' ? s.style : 'image',
          }))
        })
        .catch((e) => console.error('image param failed', e))
    }
    if (q.get('download')) {
      // let the first paint happen, then trigger the save
      setTimeout(() => download((q.get('download') as Format) ?? undefined), 400)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // agent API part 2: window.grainient
  useEffect(() => {
    const api = {
      /** current settings + ratio */
      get: () => ({
        ...(JSON.parse(JSON.stringify(stateRef.current.settings)) as Settings),
        ratio: stateRef.current.ratio,
        hasImage: !!stateRef.current.imageField,
      }),
      /** patch settings; accepts Settings fields plus {ratio: "16:9"|number, ascii: {...partial}} */
      set: (p: Record<string, unknown>) => {
        if (p.ratio !== undefined) {
          const r = typeof p.ratio === 'number' ? p.ratio : parseRatio(String(p.ratio))
          if (r) setRatio(r)
        }
        setSettings((s) => {
          const next = { ...s }
          for (const k of ['seed', 'style', 'mode', 'colors', 'grain', 'grainType', 'softness', 'vignette', 'view'] as const) {
            if (p[k] !== undefined) (next as unknown as Record<string, unknown>)[k] = p[k]
          }
          if (p.ascii && typeof p.ascii === 'object') next.ascii = { ...s.ascii, ...(p.ascii as object) }
          return next
        })
      },
      lucky,
      shuffle,
      back,
      forward,
      /** render at export size, returns a data URL. fmt: png|jpg|webp */
      export: (fmt: Format = 'png', long = EXPORT_LONG) => exportDataURL(fmt, long),
      /** trigger a browser file download */
      download: (fmt?: Format) => download(fmt),
      /** load an image URL/dataURL: sets palette + the 'image' shape style */
      fromImage: async (url: string, useShape = true) => {
        const { colors, field } = await importImageUrl(url)
        pushHistory()
        setImageField(field)
        setSettings((s) => ({ ...s, colors, seed: newSeed(), style: useShape ? 'image' : s.style }))
        return colors
      },
    }
    ;(window as unknown as Record<string, unknown>).grainient = api
    return () => {
      delete (window as unknown as Record<string, unknown>).grainient
    }
  }, [lucky, shuffle, back, forward, exportDataURL, download, pushHistory])

  const setColor = (i: number, v: string) =>
    setSettings((s) => {
      const colors = [...s.colors]
      colors[i] = v
      return { ...s, colors }
    })

  const removeColor = (i: number) =>
    setSettings((s) =>
      s.colors.length <= 2 ? s : { ...s, colors: s.colors.filter((_, j) => j !== i) },
    )

  const addColor = () =>
    setSettings((s) =>
      s.colors.length >= 6
        ? s
        : { ...s, colors: [...s.colors, randomPalette(mulberry32(newSeed()), s.mode)[0]] },
    )

  const styleChips: Style[] = imageField ? [...STYLES, 'image'] : STYLES

  // hex field mirrors the selected swatch; applies as soon as the text is a valid hex
  const effIdx = Math.min(selIdx, settings.colors.length - 1)
  useEffect(() => {
    setHexDraft(settings.colors[effIdx] ?? '')
  }, [settings.colors, effIdx])
  const onHexChange = (v: string) => {
    setHexDraft(v)
    const hex = normalizeHex(v)
    if (hex) setColor(effIdx, hex)
  }

  const ratioName = RATIOS.find(([, r]) => Math.abs(ratio - r) < 0.001)?.[0] ?? 'custom'

  const v = settings.view
  const viewChanged =
    !!v && (Math.abs(v.x - 0.5) > 0.002 || Math.abs(v.y - 0.5) > 0.002 || Math.abs(v.s - 1) > 0.002)

  return (
    <div className="app">
      <main className="stage" ref={stageRef}>
        <canvas
          ref={canvasRef}
          className={panning ? 'panning' : ''}
          style={{ width: fit.w, height: fit.h }}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerEnd}
          onPointerCancel={onCanvasPointerEnd}
          onDoubleClick={resetView}
          title="drag to pan · pinch or ⌘-scroll to zoom · double-click to reset"
        />
        {viewChanged && (
          <button className="reset-view" onClick={resetView}>
            reset view
          </button>
        )}
        {dragging && <div className="drop-overlay">drop an image — palette + gradient shape</div>}
      </main>

      <aside className="panel">
        <header className="head-row">
          <div>
            <h1>grainient</h1>
            <p className="sub">
              grainy gradients on demand<span className="kbd-hint"> · ← back · → forward</span>
            </p>
          </div>
          <button
            className="theme-btn"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? 'switch to light mode' : 'switch to dark mode'}
            aria-label="toggle color theme"
          >
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" width="16" height="16">
                <circle cx="12" cy="12" r="4.5" />
                <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />
              </svg>
            )}
          </button>
        </header>

        <button
          className="lucky"
          onClick={lucky}
          style={{ background: `linear-gradient(115deg, ${settings.colors.join(', ')})` }}
        >
          <span>✦ i'm feeling lucky</span>
        </button>

        <div className="row">
          <button className="ghost" onClick={back} disabled={histLen === 0}>
            ← back
          </button>
          <button className="ghost" onClick={shuffle}>shuffle</button>
          <div className="dl-wrap" ref={dlRef}>
            <button className="ghost wide" onClick={() => setDlOpen((o) => !o)}>
              download ▾
            </button>
            {dlOpen && (
              <div className="dl-menu">
                {FORMATS.map((f) => (
                  <button
                    key={f}
                    onClick={() => {
                      setDlOpen(false)
                      setFormat(f)
                      download(f)
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className={`bookmark ${isSaved ? 'on' : ''}`}
            onClick={toggleSave}
            title={isSaved ? 'saved — click to remove' : 'save to library'}
            aria-label={isSaved ? 'remove from saved' : 'save current gradient'}
            aria-pressed={isSaved}
          >
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.7L5 21V4a1 1 0 0 1 1-1z" />
            </svg>
          </button>
        </div>

        <section>
          <label>mode</label>
          <div className="chips">
            {MODES.map((m) => (
              <button
                key={m}
                className={`chip ${settings.mode === m ? 'active' : ''}`}
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            ))}
          </div>
        </section>

        <section>
          <label>style</label>
          <div className="chips">
            {styleChips.map((st) => (
              <button
                key={st}
                className={`chip ${settings.style === st ? 'active' : ''}`}
                onClick={() => setStyle(st)}
              >
                {st}
              </button>
            ))}
          </div>
        </section>

        <details className="acc" open>
          <summary>
            aspect ratio<span className="hint">{ratioName}</span>
          </summary>
          <div className="acc-body">
            <div className="chips">
              {RATIOS.map(([name, r]) => (
                <button
                  key={name}
                  className={`chip ${Math.abs(ratio - r) < 0.001 ? 'active' : ''}`}
                  onClick={() => setRatio(r)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        </details>

        <details className="acc" open>
          <summary>
            colors<span className="hint">{settings.colors.length}</span>
          </summary>
          <div className="acc-body">
            <div className="swatches">
              {settings.colors.map((c, i) => (
                <div
                  className={`swatch ${i === effIdx ? 'sel' : ''}`}
                  key={i}
                  title={c}
                  onMouseDown={() => setSelIdx(i)}
                >
                  <input type="color" value={c} onChange={(e) => setColor(i, e.target.value)} />
                  {settings.colors.length > 2 && (
                    <button className="x" onClick={() => removeColor(i)} title="remove">
                      ×
                    </button>
                  )}
                </div>
              ))}
              {settings.colors.length < 6 && (
                <button className="swatch add" onClick={addColor} title="add color">
                  +
                </button>
              )}
            </div>
            <input
              className="hex"
              value={hexDraft}
              onChange={(e) => onHexChange(e.target.value)}
              spellCheck={false}
              placeholder="#hex"
              aria-label="hex color for selected swatch"
            />
            <button className="ghost wide" onClick={() => fileRef.current?.click()}>
              upload image
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                onFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
        </details>

        <details className="acc">
          <summary>
            texture<span className="hint">{settings.grainType ?? 'film'}</span>
          </summary>
          <div className="acc-body">
            <div className="chips">
              {GRAIN_TYPES.map((gt) => (
                <button
                  key={gt}
                  className={`chip ${(settings.grainType ?? 'film') === gt ? 'active' : ''}`}
                  onClick={() => patch({ grainType: gt })}
                >
                  {gt}
                </button>
              ))}
            </div>
            <Slider label="grain" value={settings.grain} onChange={(v) => patch({ grain: v })} />
            <Slider label="softness" value={settings.softness} onChange={(v) => patch({ softness: v })} />
            <Slider label="vignette" value={settings.vignette} onChange={(v) => patch({ vignette: v })} />
          </div>
        </details>

        <details className="acc">
          <summary>
            ascii overlay
            <span
              role="switch"
              aria-checked={settings.ascii.enabled}
              tabIndex={0}
              className={`toggle in-summary ${settings.ascii.enabled ? 'on' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                patchAscii({ enabled: !settings.ascii.enabled })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  patchAscii({ enabled: !settings.ascii.enabled })
                }
              }}
            >
              <span />
            </span>
          </summary>
          <div className="acc-body">
            <div className="chips">
              {ASCII_SETS_UI.map((cs) => (
                <button
                  key={cs}
                  className={`chip ${(settings.ascii.set ?? 'code') === cs ? 'active' : ''}`}
                  onClick={() => patchAscii({ set: cs })}
                >
                  {cs}
                </button>
              ))}
            </div>
            <Slider
              label="size"
              value={settings.ascii.size}
              min={7}
              max={32}
              step={1}
              onChange={(v) => patchAscii({ size: v })}
            />
            <Slider label="opacity" value={settings.ascii.opacity} onChange={(v) => patchAscii({ opacity: v })} />
            <Slider label="density" value={settings.ascii.density} onChange={(v) => patchAscii({ density: v })} />
            <Slider
              label="contrast"
              value={settings.ascii.contrast ?? 0.3}
              onChange={(v) => patchAscii({ contrast: v })}
            />
          </div>
        </details>

        <details className="acc">
          <summary>
            <svg className="bm-mini" viewBox="0 0 24 24" width="12" height="12">
              <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.7L5 21V4a1 1 0 0 1 1-1z" />
            </svg>
            saved<span className="hint">{library.length}</span>
          </summary>
          <div className="acc-body">
            {library.length === 0 ? (
              <p className="sub">nothing saved yet — hit the bookmark up top</p>
            ) : (
              <div className="lib-grid">
                {library.map((item) => (
                  <div className="lib-item" key={item.id}>
                    <img src={item.thumb} alt="saved gradient" onClick={() => loadFromLibrary(item)} />
                    <button className="x" onClick={() => deleteFromLibrary(item.id)} title="delete">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      </aside>
    </div>
  )
}
