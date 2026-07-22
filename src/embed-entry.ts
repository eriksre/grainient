// Standalone embed runtime. Bundled to an IIFE and inlined into HTML exports
// (and served at /embed.js). It finds every element carrying a
// data-grainient="<seed>" attribute (single gradient) or a
// data-grainient-page="<page seed>" attribute (stitched multi-section page),
// drops a canvas behind its content, and re-renders whenever the element
// resizes — so the gradient fits any width/height/aspect-ratio you give the
// container, at any time.

import { decodeCode, decodePageCode } from './code'
import { renderGradient } from './engine'
import { renderPage } from './stitch'

const MAX_LONG = 2600 // cap the long edge so huge sections stay fast

const mounted = new WeakSet<Element>()

type Draw = (canvas: HTMLCanvasElement, w: number, h: number) => void

function attach(el: HTMLElement, draw: Draw) {
  mounted.add(el)
  const cs = getComputedStyle(el)
  if (cs.position === 'static') el.style.position = 'relative'
  el.style.isolation = 'isolate' // keeps the z-index:-1 canvas inside this element
  if (cs.overflow === 'visible') el.style.overflow = 'hidden'

  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:absolute;inset:0;z-index:-1;width:100%;height:100%;display:block'
  el.prepend(canvas)

  let raf = 0
  let lastW = 0
  let lastH = 0
  const paint = () => {
    raf = 0
    const w = el.clientWidth
    const h = el.clientHeight
    if (!w || !h || (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 2)) return
    lastW = w
    lastH = h
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const scale = Math.min(1, MAX_LONG / (Math.max(w, h) * dpr))
    draw(canvas, Math.round(w * dpr * scale), Math.round(h * dpr * scale))
  }
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(paint)
  }
  new ResizeObserver(schedule).observe(el)
  schedule()
}

function mount(el: HTMLElement): boolean {
  if (mounted.has(el)) return true
  const pageCode = el.getAttribute('data-grainient-page')
  if (pageCode) {
    const page = decodePageCode(pageCode)
    if (!page) {
      console.warn('[grainient] could not decode data-grainient-page seed:', pageCode)
      return false
    }
    const specs = page.sections.map((d) => ({ settings: d.settings, ratio: d.ratio ?? 16 / 9 }))
    const units = specs.map((s) => 1 / s.ratio)
    const totalUnits = units.reduce((a, b) => a + b, 0)
    attach(el, (canvas, w, h) => {
      // the container dictates total size; sections share height by their ratios
      const heights = units.map((u) => Math.max(2, Math.round((h * u) / totalUnits)))
      renderPage(canvas, specs, w, page.blend, heights)
    })
    return true
  }
  const code = el.getAttribute('data-grainient') ?? ''
  const spec = decodeCode(code)
  if (!spec) {
    console.warn('[grainient] could not decode data-grainient seed:', code)
    return false
  }
  attach(el, (canvas, w, h) => renderGradient(canvas, spec.settings, w, h))
  return true
}

/** mount every [data-grainient] / [data-grainient-page] element under root */
function mountAll(root: ParentNode = document): number {
  let n = 0
  root.querySelectorAll<HTMLElement>('[data-grainient], [data-grainient-page]').forEach((el) => {
    if (mount(el)) n++
  })
  return n
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => mountAll())
} else {
  mountAll()
}

const api = { mount, mountAll, decodeCode, decodePageCode }
;(window as unknown as Record<string, unknown>).GrainientEmbed = api

export default api
