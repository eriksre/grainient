# grainient — agent guide

grainient (this site) is a client-only studio for grainy, seeded, deterministic
gradients. It is built to be driven by AI agents: everything you can click in the UI
can be done with **shareable seeds**, **URL query params**, or the **`window.grainient`
JS API**, and every gradient can leave the app as an image, a one-line seed, or a
**self-contained HTML/CSS embed** that re-renders itself at any size.

Useful endpoints on this origin: this guide at `/agents.md`, a short pointer at
`/llms.txt`, and the embeddable runtime at `/embed.js`.

## 0. TL;DR recipes

**"Grab me a hero background"** — open the app and export:

```js
// Playwright / puppeteer / browser-tool
const dataUrl = await page.evaluate(() => {
  grainient.set({ style: 'rise', mode: 'dark', seed: 42, ratio: '21:9', grain: 0.6 })
  return grainient.export('webp')          // → "data:image/webp;base64,…"
})
```

**"Give the human something they can tweak"** — hand back a seed instead of pixels:

```js
const seed = await page.evaluate(() => grainient.getCode())
// → "grainient:v1?style=rise&mode=dark&seed=42&colors=1a1a2e-7b6cff-f4e3c1&ratio=21:9&grain=0.6&…"
```

The human pastes that line into the app's **share seed** box (sidebar) and sees exactly
your gradient. Works the other way too: a human copies a seed from the app, you apply it
with `grainient.setCode(seed)` — or just open `/?code=<encodeURIComponent(seed)>`.

**"Give me a background for a card"** — small subtle asset, no ascii:

```js
grainient.set({ style: 'bloom', mode: 'light', seed: 7, ratio: '4:5', grain: 0.3, vignette: 0, ascii: { enabled: false } })
grainient.export('webp', 1200)             // custom long-edge size
```

**"Build a whole landing-page backdrop"** — stitch sections with blended seams:

```js
grainient.set({ style: 'set', mode: 'light', seed: 11, ratio: '21:9' });  grainient.page.add()
grainient.set({ style: 'rise', mode: 'dark', seed: 12, ratio: '16:9' });  grainient.page.add()
grainient.page.blend(0.3)                  // how much sections cross-fade (0..1)
const pageSeed = grainient.page.getCode()  // reproducible, hand it to the human
const html = await grainient.page.exportHTML()  // one ready-to-use html file
```

**"Put a live gradient in my website"** — export HTML (`await grainient.exportHTML()`),
or write the embed yourself:

```html
<script src="https://<this-host>/embed.js"></script>
<section style="aspect-ratio: 16/9" data-grainient="grainient:v1?style=rise&seed=42&…">
  <h1>content renders on top</h1>
</section>
<section style="min-height: 200vh" data-grainient-page="grainient-page:v1?blend=0.3 grainient:v1?… grainient:v1?…">
</section>
```

The embed drops a canvas behind the element's content and re-renders whenever the
element resizes — change the aspect-ratio / height freely and it just adapts.

## 1. Shareable seeds

A **seed** is one line that captures every setting (style, mode, seed number, colors,
ratio, grain, softness, vignette, ascii settings, pan/zoom view). Format:

```
grainient:v1?style=rise&mode=mix&seed=1234&colors=1a1a2e-7b6cff-f4e3c1&ratio=16:9&grain=0.49&grainType=film&softness=0.45&vignette=0.12&ascii=1&asciiSet=code&asciiSize=11&asciiOpacity=0.67&asciiDensity=0.51&asciiContrast=0.3
```

- The payload after `?` is a plain URL query string using the exact params from §2 —
  you can hand-write seeds, and any app URL also parses as a seed.
- Decoding is deterministic: same seed → pixel-identical gradient anywhere.
- Get/apply: `grainient.getCode()` / `grainient.setCode(seed)`, the **share seed** box
  in the UI, or `/?code=<url-encoded seed>`.

A **page seed** stitches several gradients into one scrollable page. One seed per line
(newlines may be spaces); the header carries the seam cross-fade as `blend` (0..1,
0 = hard edges):

```
grainient-page:v1?blend=0.25
grainient:v1?style=set&mode=light&seed=11&ratio=21:9&…
grainient:v1?style=rise&mode=dark&seed=12&ratio=16:9&…
```

Get/apply: `grainient.page.getCode()` / `grainient.page.setCode(seed)`, the
**page builder** + **share seed** sections in the UI, or `/?page=<url-encoded page seed>`.
Lines starting with `#` or `//` are ignored; `section:` prefixes are allowed.

**Palettes**: the copy icon on the **colors** section (and `grainient.getPalette()`)
yields `#ff6a00, #d4327e, #1a1a40`. To hand a palette back, use the `colors` param /
seed field (`colors=ff6a00-d4327e-1a1a40`) or `grainient.set({ colors: ['#ff6a00', …] })`
(2–6 colors).

## 2. URL query params

Open the app with params and the gradient is fully configured on load:

```
/?style=mesh&mode=dark&seed=1234&ratio=16:9&grain=0.6&ascii=1
/?colors=ff6a00,d4327e,1a1a40&style=waves&ratio=9:16
/?mode=light&download=webp        ← auto-downloads a webp then stays open
/?code=grainient%3Av1%3Fstyle%3Drise%26seed%3D42…
```

| param | values | notes |
| --- | --- | --- |
| `code` | url-encoded seed | applies the whole seed first; other params override it |
| `page` | url-encoded page seed | fills the page builder and shows the stitched page |
| `seed` | integer | deterministic layout; same seed + settings = same image |
| `style` | `mesh` `bloom` `rise` `set` `waves` `horizon` `beams` `spotlight` `linear` `radial` `image` | `image` needs `image=` or a previously dropped image |
| `mode` | `dark` `light` `mix` | palette family; also flips ascii placement automatically |
| `colors` | `ff6a00,d4327e,1a1a40` (2–6 hex, `#` optional, `,` or `-` separated) | overrides generated palette |
| `ratio` | `16:9`, `1920x600`, `4/3`, or a bare number like `2.35` | any aspect ratio, clamped to 16:1…1:16 |
| `grain` `softness` `vignette` | `0`–`1` | texture sliders |
| `grainType` | `film` `coarse` `pixel` `dither` | grain character: fine film, big particles, chunky mosaic, fine mosaic |
| `ascii` | `1`/`0` | ascii overlay on/off |
| `asciiSize` | `7`–`32` | glyph cell size |
| `asciiOpacity` `asciiDensity` `asciiContrast` | `0`–`1` | overlay strength / coverage / band crispness |
| `asciiSet` | `classic` `code` `dots` `heavy` | glyph vocabulary |
| `view` | `x,y,s` e.g. `0.6,0.4,1.5` | pan/zoom camera: center (0.5,0.5 default) + zoom |
| `image` | URL or data-URL | imports palette + shape field (subject to CORS) |
| `format` | `png` `jpg` `webp` | preselects the export format |
| `download` | `png` `jpg` `webp` `html` | auto-triggers a file download after first paint |

## 3. `window.grainient` JS API

Available once the page has loaded (e.g. via Playwright `page.evaluate`, puppeteer,
or a browser-tool `javascript_exec`):

```js
grainient.get()                      // → current settings {seed, style, mode, colors, grain, ..., ratio, hasImage}
grainient.set({ style: 'waves', colors: ['#ff6a00', '#1a1a40'], grain: 0.7, ratio: '4:5' })
grainient.set({ ratio: '1920x600' }) // any aspect: "W:H", "WxH", or a number
grainient.set({ view: { x: 0.6, y: 0.4, s: 1.5 } })  // pan/zoom camera; x/y center (0.5 default), s zoom (0.5–4)
grainient.lucky()                    // new palette + layout (respects current mode)
grainient.shuffle()                  // new layout, same palette
grainient.back()                     // undo — restore the previous gradient (← / ⌫ in the UI)
grainient.forward()                  // redo — replay undone gradients; new lucky when the queue is empty (→)

grainient.getCode()                  // → one-line shareable seed (give this to humans!)
grainient.setCode(seed)              // apply a seed / app URL / query string → 'gradient' | 'page' | null
grainient.copyCode()                 // copy the seed to the clipboard (page seed while page view is on)
grainient.getPalette()               // → ['#ff6a00', '#1a1a40', …]

grainient.export('webp')             // → data URL at 2880px long edge (page image while page view is on)
grainient.export('jpg', 1200)        // custom size
grainient.download('png')            // trigger a real file download
grainient.copy()                     // copy image to clipboard (jpg where supported, else png)
await grainient.exportHTML()         // → self-contained HTML doc; canvas resizes to its container
await grainient.downloadHTML()       // download that HTML doc

await grainient.fromImage(url)       // import palette + shape from an image URL, returns colors
await grainient.fromImage(url, false) // palette only, keep current style
```

`set` accepts partial `ascii` objects too: `grainient.set({ ascii: { enabled: true, size: 18 } })`.

### Page builder API — stitch sections into one blended page

```js
grainient.page.add()                 // append the current gradient (also bookmarks it, shows the page)
grainient.page.get()                 // → array of section seeds, top to bottom
grainient.page.getCode()             // → one page seed for everything (includes blend)
grainient.page.setCode(pageSeed)     // replace all sections → boolean
grainient.page.blend(0.4)            // get/set seam cross-fade 0..1
grainient.page.view(true)            // show the stitched page on the stage (false = single gradient)
grainient.page.remove(0)             // drop a section by index
grainient.page.clear()
await grainient.page.exportHTML()    // → one HTML doc, sections stitched with blended seams
await grainient.page.download()      // download it
grainient.page.preview()             // open it in a new tab
```

While page view is active, `export` / `download` / `copy` operate on the whole
stitched page — what you see is what you export.

## 4. HTML/CSS embeds

The HTML export (download menu → `html`, `exportHTML()`, or `?download=html`) is a
single self-contained file: the gradient section(s) plus a ~19 KB inlined runtime.
No dependencies, no network. To integrate into an existing site, copy the `<section>`
block, the two `.grainient` CSS rules, and the `<script>` into your page — or load
the same runtime from this origin via `<script src="…/embed.js"></script>`.

Rules of the runtime:

- Any element with `data-grainient="<seed>"` (single) or
  `data-grainient-page="<page seed>"` (stitched, blended page) gets a canvas placed
  *behind* its content (`z-index: -1`, isolated), rendered at device-pixel resolution.
- The canvas re-renders whenever the element resizes — set `aspect-ratio`,
  `min-height: 100vh`, a fixed height, anything responsive; it adapts.
- For pages, the container dictates total size; sections split the height in
  proportion to their aspect ratios, and adjacent sections cross-fade by `blend`.
- The element keeps `background: <first palette color>` as a no-JS fallback.
- Elements added after load: call `GrainientEmbed.mountAll()`.
- The `image` style cannot travel inside a seed (the source bitmap isn't encoded);
  embeds fall back to `mesh` for it. Export images instead for image-style gradients.

## 5. Determinism

Rendering is fully seeded: identical `{seed, style, mode, colors, grain, softness,
vignette, ascii, view}` at a given canvas size always produce pixel-identical output,
and the preview matches the export. Randomness only enters through `lucky()`/`shuffle()`
(which pick a new seed). Note that the *composition* is laid out for the canvas's
aspect — the same seed at 16:9 and 9:16 gives the same mood, re-composed to fit.

## 6. Style cheat-sheet

- `mesh` — soft directionless color-blob field (the signature look)
- `bloom` — composed corner glows over an anchor field
- `rise` / `set` — a radial dome anchored to the bottom / top edge, varied position, width, and squash
- `waves` — stacked rippling ridges that blend into each other, like layered hills
- `horizon` — soft strata with a squashed sun-glow near the brightest edge
- `beams` — long streaks sharing one dominant diagonal
- `spotlight` — near-black stage with a hot squashed beam of light
- `linear` / `radial` — classic directional fades (radial always orders colors by luminance for a clean glow)
- `image` — uses a dropped/imported image as the gradient's color field (its "shape")

Good defaults for web backgrounds: heroes → `rise`, `horizon`, `bloom` at `21:9`;
cards → `bloom`, `mesh`, `radial` at `4:5`/`1:1` with `grain ≤ 0.4` and ascii off;
full-page moods → `waves` or `linear` with `softness ≥ 0.6`. For stitched pages,
give neighboring sections a shared or adjacent hue and `blend ≥ 0.25` so the seams
melt (e.g. a warm `set` on top flowing into a purple `rise` at the bottom).
