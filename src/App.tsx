import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_VIEW,
  mulberry32,
  renderGradient,
  VIEW_MAX_SCALE,
  VIEW_MIN_SCALE,
  type Mode,
  type Settings,
  type Style,
  type ViewTransform,
} from './engine'
import { importImage, importImageUrl, randomPalette } from './palette'
import {
  ASCII_SETS_UI,
  baseSettings,
  decodeCode,
  decodePageCode,
  encodeCode,
  GRAIN_TYPES,
  MODES,
  parseRatio,
  ratioParam,
  RATIOS,
  settingsFromParams,
  STYLES,
  DEFAULT_BLEND,
  type DecodedGradient,
} from './code'
import { pageHeightUnits, renderPage } from './stitch'

export type Format = 'png' | 'jpg' | 'webp'
const FORMATS: Format[] = ['png', 'jpg', 'webp']
const MIME: Record<Format, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }

const PREVIEW_LONG = 1440
const EXPORT_LONG = 2880

const newSeed = () => Math.floor(Math.random() * 2 ** 31)

const makeInitial = (): Settings => baseSettings(newSeed())

function dims(ratio: number, long: number): [number, number] {
  return ratio >= 1 ? [long, Math.round(long / ratio)] : [Math.round(long * ratio), long]
}

/** decode stored page sections into render-ready specs */
function specsFromSections(sections: { code: string; ratio: number }[]) {
  return sections
    .map((sec) => {
      const d = decodeCode(sec.code)
      return d ? { settings: d.settings, ratio: d.ratio ?? sec.ratio } : null
    })
    .filter((s): s is { settings: Settings; ratio: number } => s !== null)
}

/** one-line page seed straight from the stored section codes */
function pageSeedText(sections: { code: string }[], blend: number, sep = '\n'): string {
  return [`grainient-page:v1?blend=${Math.round(blend * 100) / 100}`, ...sections.map((s) => s.code)].join(sep)
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

/** one stitched-page section: the code is the source of truth, thumb is for the UI */
interface PageSec {
  id: string
  code: string
  ratio: number
  thumb: string
}

const PAGE_KEY = 'grainient.page.v1'

interface PageStore {
  sections: PageSec[]
  blend: number
}

function readPage(): PageStore {
  try {
    const raw = JSON.parse(localStorage.getItem(PAGE_KEY) ?? 'null')
    if (Array.isArray(raw)) return { sections: raw, blend: DEFAULT_BLEND } // legacy shape
    if (raw && Array.isArray(raw.sections)) {
      return { sections: raw.sections, blend: typeof raw.blend === 'number' ? raw.blend : DEFAULT_BLEND }
    }
  } catch {
    // fall through
  }
  return { sections: [], blend: DEFAULT_BLEND }
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
  const [copied, setCopied] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const [paletteCopied, setPaletteCopied] = useState(false)
  const [pageCopied, setPageCopied] = useState(false)
  const [codeDraft, setCodeDraft] = useState('')
  const [pasteMsg, setPasteMsg] = useState<string | null>(null)
  const [ratioDraft, setRatioDraft] = useState('')
  const [sections, setSections] = useState<PageSec[]>(() => readPage().sections)
  const [blend, setBlend] = useState<number>(() => readPage().blend)
  // page mode: the stage shows the stitched page instead of the single gradient.
  // Defaults on when a built page exists — the page is what you're working on.
  const [pageMode, setPageMode] = useState<boolean>(() => readPage().sections.length > 0)
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
  const stateRef = useRef({ settings, ratio, imageField, format, sections, blend, pageMode })
  useEffect(() => {
    stateRef.current = { settings, ratio, imageField, format, sections, blend, pageMode }
  })

  // page mode changes mirror into the ref immediately so chained agent-API
  // calls within one tick (add → getCode → export) read consistent state
  const setPageModeSync = useCallback((v: boolean) => {
    stateRef.current.pageMode = v
    setPageMode(v)
  }, [])

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
    if (stateRef.current.pageMode && stateRef.current.sections.length > 0) return // no pan/zoom on the stitched page
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
      // in page mode the canvas is just a preview — let the browser scroll normally
      if (stateRef.current.pageMode && stateRef.current.sections.length > 0) return
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

  // what the stage displays: the single gradient's ratio, or the whole stitched page's
  const pageActive = pageMode && sections.length > 0
  const stageRatio = pageActive ? 1 / Math.max(0.05, pageHeightUnits(specsFromSections(sections))) : ratio

  // fit the canvas inside the stage while keeping the displayed ratio
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => {
      const cs = getComputedStyle(el)
      const cw = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const ch = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      let w = cw
      let h = w / stageRatio
      if (h > ch) {
        h = ch
        w = h * stageRatio
      }
      setFit({ w: Math.max(60, Math.floor(w)), h: Math.max(60, Math.floor(h)) })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [stageRatio])

  // render
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    if (pageActive) {
      const specs = specsFromSections(sections)
      const units = pageHeightUnits(specs)
      const w = units >= 1 ? Math.max(320, Math.round(PREVIEW_LONG / units)) : PREVIEW_LONG
      renderPage(c, specs, w, blend)
    } else {
      const [w, h] = dims(ratio, PREVIEW_LONG)
      renderGradient(c, settings, w, h, imageField)
    }
  }, [settings, ratio, imageField, pageActive, sections, blend])

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

  /** render whatever the stage shows — the single gradient, or the stitched page in page mode */
  const renderCurrentTo = useCallback((c: HTMLCanvasElement, long: number) => {
    const { settings, ratio, imageField, pageMode, sections, blend } = stateRef.current
    const specs = pageMode && sections.length > 0 ? specsFromSections(sections) : []
    if (specs.length > 0) {
      const units = pageHeightUnits(specs)
      const w = units >= 1 ? Math.max(320, Math.round(long / units)) : long
      renderPage(c, specs, w, blend)
    } else {
      const [w, h] = dims(ratio, long)
      renderGradient(c, settings, w, h, imageField)
    }
  }, [])

  const exportDataURL = useCallback(
    (fmt: Format = 'png', long = EXPORT_LONG): string => {
      const c = document.createElement('canvas')
      renderCurrentTo(c, long)
      return c.toDataURL(MIME[fmt], 0.92)
    },
    [renderCurrentTo],
  )

  const download = useCallback(
    (fmt?: Format) => {
      const f = fmt && FORMATS.includes(fmt) ? fmt : stateRef.current.format
      const url = exportDataURL(f)
      const a = document.createElement('a')
      a.href = url
      const { pageMode, sections, settings, ratio } = stateRef.current
      if (pageMode && sections.length > 0) {
        a.download = `grainient-page-${sections.length}sections.${f}`
      } else {
        const rName = (RATIOS.find(([, rr]) => Math.abs(ratio - rr) < 0.001)?.[0] ?? ratio.toFixed(2)).replace(':', 'x')
        a.download = `grainient-${settings.seed}-${rName}.${f}`
      }
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

  // copy the rendered gradient to the clipboard — as JPG where the browser
  // allows writing it, falling back to PNG (most browsers only accept PNG)
  const copyImage = useCallback(async () => {
    try {
      const c = document.createElement('canvas')
      renderCurrentTo(c, EXPORT_LONG)
      // promise form so Safari accepts it too
      const blobFor = (type: string) =>
        new Promise<Blob>((resolve, reject) =>
          c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, 0.92),
        )
      const CI = ClipboardItem as unknown as { supports?: (t: string) => boolean }
      const type = CI.supports?.('image/jpeg') ? 'image/jpeg' : 'image/png'
      try {
        await navigator.clipboard.write([new ClipboardItem({ [type]: blobFor(type) })])
      } catch (err) {
        if (type === 'image/png') throw err
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobFor('image/png') })])
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch (err) {
      console.error('copy failed', err)
    }
  }, [renderCurrentTo])

  // --- shareable seeds ---
  const copySeed = useCallback(async () => {
    try {
      const { settings, ratio, pageMode, sections, blend } = stateRef.current
      const text =
        pageMode && sections.length > 0 ? pageSeedText(sections, blend) : encodeCode(settings, ratio)
      await navigator.clipboard.writeText(text)
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 1400)
    } catch (err) {
      console.error('copy failed', err)
    }
  }, [])

  const copyPalette = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(stateRef.current.settings.colors.join(', '))
      setPaletteCopied(true)
      setTimeout(() => setPaletteCopied(false), 1400)
    } catch (err) {
      console.error('copy failed', err)
    }
  }, [])

  const renderThumb = useCallback((s: Settings, r: number): string => {
    const [w, h] = dims(r, 320)
    const c = document.createElement('canvas')
    renderGradient(c, s, w, h, s.style === 'image' ? stateRef.current.imageField : null)
    return c.toDataURL('image/jpeg', 0.7)
  }, [])

  // sections are computed against the ref (not a functional update) so that
  // chained agent-API calls within one tick stay consistent
  const persistPage = useCallback(
    (update: (prev: PageSec[]) => PageSec[], blendOverride?: number) => {
      if (blendOverride !== undefined) {
        setBlend(blendOverride)
        stateRef.current.blend = blendOverride
      }
      const next = update(stateRef.current.sections)
      stateRef.current.sections = next
      try {
        localStorage.setItem(
          PAGE_KEY,
          JSON.stringify({ sections: next, blend: blendOverride ?? stateRef.current.blend }),
        )
      } catch (e) {
        console.error('page save failed', e)
      }
      if (next.length === 0) setPageModeSync(false)
      setSections(next)
    },
    [setPageModeSync],
  )

  const persistBlend = useCallback(
    (v: number) => persistPage((prev) => prev, v),
    [persistPage],
  )

  const toSections = useCallback(
    (decoded: DecodedGradient[]): PageSec[] =>
      decoded.map((d) => {
        const r = d.ratio ?? 16 / 9
        return {
          id: Math.random().toString(36).slice(2),
          code: encodeCode(d.settings, r),
          ratio: r,
          thumb: renderThumb(d.settings, r),
        }
      }),
    [renderThumb],
  )

  /** apply a pasted gradient seed or page seed; returns what it did (null = invalid) */
  const applyCodeText = useCallback(
    (text: string): 'gradient' | 'page' | null => {
      const decoded = decodePageCode(text)
      if (!decoded) return null
      if (decoded.sections.length === 1) {
        pushHistory()
        setSettings(decoded.sections[0].settings)
        if (decoded.sections[0].ratio) setRatio(decoded.sections[0].ratio)
        setPageModeSync(false)
        return 'gradient'
      }
      persistPage(() => toSections(decoded.sections), decoded.blend)
      setPageModeSync(true)
      return 'page'
    },
    [pushHistory, persistPage, toSections, setPageModeSync],
  )

  const onCodeDraft = (v: string) => {
    setCodeDraft(v)
    if (!v.trim()) {
      setPasteMsg(null)
      return
    }
    const result = applyCodeText(v)
    if (result) {
      setCodeDraft('')
      setPasteMsg(result === 'page' ? 'page code applied — see page builder' : 'code applied ✓')
      setTimeout(() => setPasteMsg(null), 2600)
    } else if (v.trim().length > 24) {
      setPasteMsg("that doesn't look like a grainient code")
    } else {
      setPasteMsg(null)
    }
  }

  const onRatioDraft = (v: string) => {
    setRatioDraft(v)
    const r = parseRatio(v)
    if (r) setRatio(r)
  }

  // --- page builder: stitch multiple gradients into one scrollable page ---
  const sectionSpecs = useCallback(() => specsFromSections(stateRef.current.sections), [])

  const addSection = useCallback(() => {
    const { settings, ratio, imageField } = stateRef.current
    const thumb = renderThumb(settings, ratio)
    const item: PageSec = {
      id: Math.random().toString(36).slice(2),
      code: encodeCode(settings, ratio),
      ratio,
      thumb,
    }
    persistPage((prev) => [...prev, item].slice(0, 16))
    // stitching a gradient into the page also bookmarks it in the saved library
    const key = gradKey(settings, ratio)
    persistLib((prev) => {
      if (prev.some((it) => gradKey(it.settings, it.ratio) === key)) return prev
      const lib: LibItem = {
        id: Math.random().toString(36).slice(2),
        ts: Date.now(),
        settings: JSON.parse(JSON.stringify(settings)),
        ratio,
        thumb,
      }
      if (settings.style === 'image' && imageField) lib.image = imageField.toDataURL('image/jpeg', 0.85)
      return [lib, ...prev].slice(0, 40)
    })
    setPageModeSync(true)
  }, [persistPage, persistLib, renderThumb, setPageModeSync])

  const removeSection = useCallback(
    (id: string) => persistPage((prev) => prev.filter((s) => s.id !== id)),
    [persistPage],
  )

  const moveSection = useCallback(
    (id: string, dir: -1 | 1) =>
      persistPage((prev) => {
        const i = prev.findIndex((s) => s.id === id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= prev.length) return prev
        const next = [...prev]
        ;[next[i], next[j]] = [next[j], next[i]]
        return next
      }),
    [persistPage],
  )

  const loadSection = useCallback(
    (sec: PageSec) => {
      const d = decodeCode(sec.code)
      if (!d) return
      pushHistory()
      setSettings(d.settings)
      if (d.ratio) setRatio(d.ratio)
      setPageModeSync(false)
    },
    [pushHistory, setPageModeSync],
  )

  const copyPageCode = useCallback(async () => {
    try {
      const { sections, blend } = stateRef.current
      await navigator.clipboard.writeText(pageSeedText(sections, blend))
      setPageCopied(true)
      setTimeout(() => setPageCopied(false), 1400)
    } catch (err) {
      console.error('copy failed', err)
    }
  }, [])

  const downloadHTML = useCallback(async () => {
    const { settings, ratio, pageMode, sections, blend } = stateRef.current
    const m = await import('./export-html')
    if (pageMode && sections.length > 0) {
      m.downloadEmbedHTML(sectionSpecs(), 'grainient-page.html', { title: 'grainient page', blend })
    } else {
      m.downloadEmbedHTML([{ settings, ratio }], `grainient-${settings.seed}.html`)
    }
  }, [sectionSpecs])

  const downloadPageHTML = useCallback(async () => {
    const specs = sectionSpecs()
    if (!specs.length) return
    const m = await import('./export-html')
    m.downloadEmbedHTML(specs, 'grainient-page.html', { title: 'grainient page', blend: stateRef.current.blend })
  }, [sectionSpecs])

  const previewPage = useCallback(async () => {
    const specs = sectionSpecs()
    if (!specs.length) return
    const m = await import('./export-html')
    m.previewEmbedHTML(specs, { title: 'grainient page', blend: stateRef.current.blend })
  }, [sectionSpecs])

  // agent API part 1: URL params on load
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const fmt = q.get('format') ?? q.get('download')
    if (fmt && (FORMATS as string[]).includes(fmt)) setFormat(fmt as Format)
    const r = parseRatio(q.get('ratio'))
    if (r) setRatio(r)
    // a full shareable code can ride in ?code= (individual params still override it)
    let base = stateRef.current.settings
    const codeParam = q.get('code')
    if (codeParam) {
      const d = decodeCode(codeParam)
      if (d) {
        base = d.settings
        setSettings(d.settings)
        if (d.ratio && !r) setRatio(d.ratio)
      }
    }
    const fromParams = settingsFromParams(q, base)
    if (fromParams) setSettings(fromParams)
    // ?page= accepts a full page seed, fills the page builder, and shows the page
    const pageParam = q.get('page')
    if (pageParam) {
      const decoded = decodePageCode(pageParam)
      if (decoded) {
        persistPage(() => toSections(decoded.sections), decoded.blend)
        setPageModeSync(true)
      }
    }
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
    const dl = q.get('download')
    if (dl) {
      // let the first paint happen, then trigger the save
      setTimeout(() => {
        if (dl === 'html') downloadHTML()
        else download((FORMATS as string[]).includes(dl) ? (dl as Format) : undefined)
      }, 400)
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
          if (r) {
            stateRef.current.ratio = r // keep chained same-tick API calls consistent
            setRatio(r)
          }
        }
        const s = stateRef.current.settings
        const next = { ...s }
        for (const k of ['seed', 'style', 'mode', 'colors', 'grain', 'grainType', 'softness', 'vignette', 'view'] as const) {
          if (p[k] !== undefined) (next as unknown as Record<string, unknown>)[k] = p[k]
        }
        if (p.ascii && typeof p.ascii === 'object') next.ascii = { ...s.ascii, ...(p.ascii as object) }
        stateRef.current.settings = next
        setSettings(next)
      },
      lucky,
      shuffle,
      back,
      forward,
      /** render at export size, returns a data URL. fmt: png|jpg|webp */
      export: (fmt: Format = 'png', long = EXPORT_LONG) => exportDataURL(fmt, long),
      /** trigger a browser file download */
      download: (fmt?: Format) => download(fmt),
      /** copy the rendered image to the clipboard (jpg where supported, else png) */
      copy: copyImage,
      /** one-line shareable seed for the current gradient (settings + ratio) */
      getCode: () => encodeCode(stateRef.current.settings, stateRef.current.ratio),
      /** apply a shareable seed / app URL / query string; returns what it applied */
      setCode: (code: string) => applyCodeText(code),
      /** copy the shareable seed to the clipboard (page seed while page view is active) */
      copyCode: copySeed,
      /** palette as css hex values, e.g. ["#ff6a00", "#1a1a40"] */
      getPalette: () => [...stateRef.current.settings.colors],
      /** self-contained HTML document embedding the current gradient (async) */
      exportHTML: async () => {
        const { settings, ratio } = stateRef.current
        const m = await import('./export-html')
        return m.buildEmbedHTML([{ settings, ratio }])
      },
      /** download the current gradient as a resizable HTML embed */
      downloadHTML,
      /** multi-section page builder — stitch gradients into one blended, scrollable page */
      page: {
        /** section seeds, top to bottom */
        get: () => stateRef.current.sections.map((s) => s.code),
        /** append the current gradient as a section (also bookmarks it, shows the page) */
        add: addSection,
        /** replace all sections from a page seed (or several seeds) */
        setCode: (code: string) => {
          const decoded = decodePageCode(code)
          if (!decoded) return false
          persistPage(() => toSections(decoded.sections), decoded.blend)
          setPageModeSync(true)
          return true
        },
        /** one shareable page seed for every section (includes the blend) */
        getCode: () => pageSeedText(stateRef.current.sections, stateRef.current.blend),
        remove: (index: number) => {
          const sec = stateRef.current.sections[index]
          if (sec) removeSection(sec.id)
        },
        clear: () => persistPage(() => []),
        /** show/hide the stitched page on the stage; returns the resulting state */
        view: (on = true) => {
          const next = on && stateRef.current.sections.length > 0
          setPageModeSync(next)
          return next
        },
        /** get or set how much adjacent sections cross-fade (0..1) */
        blend: (v?: number) => {
          if (typeof v === 'number') persistBlend(Math.min(1, Math.max(0, v)))
          return typeof v === 'number' ? Math.min(1, Math.max(0, v)) : stateRef.current.blend
        },
        /** self-contained HTML document with all sections stitched (async) */
        exportHTML: async () => {
          const m = await import('./export-html')
          return m.buildEmbedHTML(sectionSpecs(), { title: 'grainient page', blend: stateRef.current.blend })
        },
        download: downloadPageHTML,
        preview: previewPage,
      },
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
  }, [
    lucky,
    shuffle,
    back,
    forward,
    exportDataURL,
    download,
    copyImage,
    pushHistory,
    applyCodeText,
    toSections,
    copySeed,
    downloadHTML,
    addSection,
    removeSection,
    persistPage,
    persistBlend,
    setPageModeSync,
    sectionSpecs,
    downloadPageHTML,
    previewPage,
  ])

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

  const ratioName = RATIOS.find(([, r]) => Math.abs(ratio - r) < 0.001)?.[0] ?? ratioParam(ratio)

  const v = settings.view
  const viewChanged =
    !!v && (Math.abs(v.x - 0.5) > 0.002 || Math.abs(v.y - 0.5) > 0.002 || Math.abs(v.s - 1) > 0.002)

  return (
    <div className="app">
      <main className="stage" ref={stageRef}>
        <canvas
          ref={canvasRef}
          className={`${panning ? 'panning' : ''} ${pageActive ? 'page' : ''}`}
          style={{ width: fit.w, height: fit.h }}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerEnd}
          onPointerCancel={onCanvasPointerEnd}
          onDoubleClick={pageActive ? undefined : resetView}
          title={
            pageActive
              ? 'stitched page preview — click a section in the page builder to edit it'
              : 'drag to pan · pinch or ⌘-scroll to zoom · double-click to reset'
          }
        />
        {viewChanged && !pageActive && (
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
              grainy gradients on demand
              <span className="kbd-hint">
                <br />
                navigate using ← &amp; → arrows
              </span>
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
                <button
                  onClick={() => {
                    setDlOpen(false)
                    downloadHTML()
                  }}
                  title="self-contained html/css embed — resizes to any container"
                >
                  html
                </button>
              </div>
            )}
          </div>
          <button
            className={`bookmark ${copied ? 'on' : ''}`}
            onClick={copyImage}
            title="copy image to clipboard"
            aria-label="copy gradient image to clipboard"
          >
            {copied ? (
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path d="M4.5 12.5l5 5 10-11" fill="none" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16">
                <rect x="9" y="9" width="11" height="11" rx="2" fill="none" />
                <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" fill="none" />
              </svg>
            )}
          </button>
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
                  onClick={() => {
                    setRatio(r)
                    setRatioDraft('')
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
            <input
              className="hex"
              value={ratioDraft}
              onChange={(e) => onRatioDraft(e.target.value)}
              spellCheck={false}
              placeholder="custom · 21:9, 1920x600, 2.35"
              aria-label="custom aspect ratio"
            />
          </div>
        </details>

        <details className="acc" open>
          <summary>
            colors<span className="hint">{settings.colors.length}</span>
            <button
              className={`copy-mini ${paletteCopied ? 'on' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                copyPalette()
              }}
              title="copy palette"
              aria-label="copy palette to clipboard"
            >
              {paletteCopied ? (
                <svg viewBox="0 0 24 24" width="13" height="13">
                  <path d="M4.5 12.5l5 5 10-11" fill="none" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="13" height="13">
                  <rect x="9" y="9" width="11" height="11" rx="2" fill="none" />
                  <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" fill="none" />
                </svg>
              )}
            </button>
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
            share seed
            <button
              className={`copy-mini summary-end ${codeCopied ? 'on' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                copySeed()
              }}
              title={pageActive ? 'copy page seed' : 'copy seed'}
              aria-label="copy shareable seed to clipboard"
            >
              {codeCopied ? (
                <svg viewBox="0 0 24 24" width="13" height="13">
                  <path d="M4.5 12.5l5 5 10-11" fill="none" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="13" height="13">
                  <rect x="9" y="9" width="11" height="11" rx="2" fill="none" />
                  <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" fill="none" />
                </svg>
              )}
            </button>
          </summary>
          <div className="acc-body">
            <p className="sub">
              {pageActive
                ? 'this seed recreates the whole stitched page — colors, grain, ascii, blend, every section.'
                : 'a seed recreates this exact gradient — colors, grain, ascii, everything.'}
            </p>
            <div className="code-row">
              <input
                className="hex"
                readOnly
                value={pageActive ? pageSeedText(sections, blend, ' ') : encodeCode(settings, ratio)}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="shareable grainient seed"
              />
              <button className="ghost" onClick={copySeed}>
                {codeCopied ? 'copied ✓' : 'copy'}
              </button>
            </div>
            <textarea
              className="hex paste"
              value={codeDraft}
              onChange={(e) => onCodeDraft(e.target.value)}
              spellCheck={false}
              rows={2}
              placeholder="paste a seed, page seed, or app url…"
              aria-label="paste a grainient seed"
            />
            {pasteMsg && <p className="sub">{pasteMsg}</p>}
          </div>
        </details>

        <details className="acc" open={sections.length > 0}>
          <summary>
            page builder
            <span className="hint">
              {sections.length > 0 ? `${sections.length} section${sections.length > 1 ? 's' : ''}` : ''}
            </span>
            <span
              role="switch"
              aria-checked={pageActive}
              aria-label="show the stitched page on the canvas"
              tabIndex={0}
              className={`toggle in-summary ${pageActive ? 'on' : ''}`}
              title={pageActive ? 'showing the stitched page — switch back to the single gradient' : 'show the stitched page'}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (sections.length > 0) setPageModeSync(!pageActive)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  if (sections.length > 0) setPageModeSync(!pageActive)
                }
              }}
            >
              <span />
            </span>
          </summary>
          <div className="acc-body">
            <p className="sub">
              stitch gradients into one scrollable page — seams cross-fade into each other. export it as a single
              html file or share it as a page seed.
            </p>
            <button className="ghost wide" onClick={addSection}>
              + add current gradient as section
            </button>
            {sections.length > 1 && (
              <Slider label="blend" value={blend} onChange={persistBlend} />
            )}
            {sections.length > 0 && (
              <>
                <div className="page-list">
                  {sections.map((sec, i) => (
                    <div className="page-row" key={sec.id}>
                      <img
                        src={sec.thumb}
                        alt={`section ${i + 1}`}
                        onClick={() => loadSection(sec)}
                        title="load into editor"
                      />
                      <span className="meta">
                        {i + 1} · {ratioParam(sec.ratio)}
                      </span>
                      <button className="mini" onClick={() => moveSection(sec.id, -1)} disabled={i === 0} title="move up">
                        ↑
                      </button>
                      <button
                        className="mini"
                        onClick={() => moveSection(sec.id, 1)}
                        disabled={i === sections.length - 1}
                        title="move down"
                      >
                        ↓
                      </button>
                      <button className="mini" onClick={() => removeSection(sec.id)} title="remove">
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <div className="row">
                  <button className="ghost" onClick={previewPage} title="open the stitched page in a new tab">
                    preview
                  </button>
                  <button className="ghost" onClick={copyPageCode} title="copy a shareable page seed">
                    {pageCopied ? 'copied ✓' : 'copy seed'}
                  </button>
                  <button className="ghost" onClick={downloadPageHTML} title="download the page as one html file">
                    html
                  </button>
                </div>
              </>
            )}
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
