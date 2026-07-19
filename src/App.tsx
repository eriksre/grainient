import { useCallback, useEffect, useRef, useState } from 'react'
import { mulberry32, renderGradient, type Settings, type Style } from './engine'
import { importImage, randomPalette } from './palette'

const RATIOS: [string, number][] = [
  ['21:9', 21 / 9],
  ['16:9', 16 / 9],
  ['3:2', 3 / 2],
  ['1:1', 1],
  ['4:5', 4 / 5],
  ['9:16', 9 / 16],
]

const STYLES: Style[] = ['mesh', 'waves', 'beams', 'spotlight', 'linear', 'radial']

const PREVIEW_LONG = 1440
const EXPORT_LONG = 2880

const newSeed = () => Math.floor(Math.random() * 2 ** 31)

function makeInitial(): Settings {
  const seed = newSeed()
  return {
    seed,
    style: 'mesh',
    mode: 'mix',
    colors: randomPalette(mulberry32(seed)),
    grain: 0.55,
    softness: 0.65,
    vignette: 0.12,
    ascii: { enabled: false, size: 14, opacity: 0.8, density: 0.9 },
  }
}

function dims(ratio: number, long: number): [number, number] {
  return ratio >= 1 ? [long, Math.round(long / ratio)] : [Math.round(long * ratio), long]
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

export default function App() {
  const [settings, setSettings] = useState<Settings>(makeInitial)
  const [ratio, setRatio] = useState(16 / 9)
  const [dragging, setDragging] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [fit, setFit] = useState({ w: 800, h: 450 })

  const patch = (p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p }))
  const patchAscii = (p: Partial<Settings['ascii']>) =>
    setSettings((s) => ({ ...s, ascii: { ...s.ascii, ...p } }))

  const lucky = useCallback(() => {
    const seed = newSeed()
    setSettings((s) => ({ ...s, seed, colors: randomPalette(mulberry32(seed)) }))
  }, [])

  const shuffle = useCallback(() => setSettings((s) => ({ ...s, seed: newSeed() })), [])

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
    renderGradient(c, settings, w, h)
  }, [settings, ratio])

  // spacebar = feeling lucky, for maximum spam
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'BUTTON' || t.tagName === 'TEXTAREA') return
      e.preventDefault()
      lucky()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lucky])

  const onFiles = useCallback(async (files: FileList | null) => {
    const f = files?.[0]
    if (!f || !f.type.startsWith('image/')) return
    try {
      const { colors } = await importImage(f)
      if (colors.length >= 2) setSettings((s) => ({ ...s, colors, seed: newSeed() }))
    } catch (err) {
      console.error('palette extraction failed', err)
    }
  }, [])

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

  const download = useCallback(() => {
    const [w, h] = dims(ratio, EXPORT_LONG)
    const c = document.createElement('canvas')
    renderGradient(c, settings, w, h)
    c.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `grainient-${settings.seed}.png`
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }, [ratio, settings])

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
        : { ...s, colors: [...s.colors, randomPalette(mulberry32(newSeed()))[0]] },
    )

  return (
    <div className="app">
      <main className="stage" ref={stageRef}>
        <canvas ref={canvasRef} style={{ width: fit.w, height: fit.h }} />
        {dragging && <div className="drop-overlay">drop an image to sample its palette</div>}
      </main>

      <aside className="panel">
        <header>
          <h1>grainient</h1>
          <p className="sub">grainy gradients on demand · space bar works too</p>
        </header>

        <button
          className="lucky"
          onClick={lucky}
          style={{ background: `linear-gradient(115deg, ${settings.colors.join(', ')})` }}
        >
          <span>✦ i'm feeling lucky</span>
        </button>

        <div className="row">
          <button className="ghost" onClick={shuffle}>shuffle layout</button>
          <button className="ghost" onClick={download}>download png</button>
        </div>

        <section>
          <label>style</label>
          <div className="chips">
            {STYLES.map((st) => (
              <button
                key={st}
                className={`chip ${settings.style === st ? 'active' : ''}`}
                onClick={() => patch({ style: st })}
              >
                {st}
              </button>
            ))}
          </div>
        </section>

        <section>
          <label>aspect ratio</label>
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
        </section>

        <section>
          <label>colors</label>
          <div className="swatches">
            {settings.colors.map((c, i) => (
              <div className="swatch" key={i} title={c}>
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
          <button className="ghost wide" onClick={() => fileRef.current?.click()}>
            palette from image…
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
        </section>

        <section>
          <label>texture</label>
          <Slider label="grain" value={settings.grain} onChange={(v) => patch({ grain: v })} />
          <Slider label="softness" value={settings.softness} onChange={(v) => patch({ softness: v })} />
          <Slider label="vignette" value={settings.vignette} onChange={(v) => patch({ vignette: v })} />
        </section>

        <section>
          <div className="toggle-row">
            <label>ascii overlay</label>
            <button
              className={`toggle ${settings.ascii.enabled ? 'on' : ''}`}
              onClick={() => patchAscii({ enabled: !settings.ascii.enabled })}
              aria-pressed={settings.ascii.enabled}
            >
              <span />
            </button>
          </div>
          {settings.ascii.enabled && (
            <>
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
            </>
          )}
        </section>

        <footer className="sub">drop any image anywhere to steal its colors</footer>
      </aside>
    </div>
  )
}
