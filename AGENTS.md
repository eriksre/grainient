# grainient — agent guide

grainient is a client-only gradient studio. AI agents can drive it two ways without
touching the UI: **URL query params** (declarative, zero JS) or the **`window.grainient`
JS API** (imperative, returns image data). Start the app with `npm run dev`
(default: http://localhost:5173).

## 1. URL query params

Open the app with params and the gradient is fully configured on load:

```
http://localhost:5173/?style=mesh&mode=dark&seed=1234&ratio=16:9&grain=0.6&ascii=1
http://localhost:5173/?colors=ff6a00,d4327e,1a1a40&style=waves&ratio=9:16
http://localhost:5173/?mode=light&download=webp        ← auto-downloads a webp then stays open
http://localhost:5173/?image=https://example.com/pic.jpg&style=image
```

| param | values | notes |
| --- | --- | --- |
| `seed` | integer | deterministic layout; same seed + settings = same image |
| `style` | `mesh` `bloom` `rise` `set` `waves` `horizon` `beams` `spotlight` `linear` `radial` `image` | `image` needs `image=` or a previously dropped image |
| `mode` | `dark` `light` `mix` | palette family; also flips ascii placement automatically |
| `colors` | `ff6a00,d4327e,1a1a40` (2–6 hex, `#` optional, `,` or `-` separated) | overrides generated palette |
| `ratio` | `16:9`, `1:1`, `9:16`, … (`:`/`x`//` separators) | canvas aspect |
| `grain` `softness` `vignette` | `0`–`1` | texture sliders |
| `ascii` | `1`/`0` | ascii overlay on/off |
| `asciiSize` | `7`–`32` | glyph cell size |
| `asciiOpacity` `asciiDensity` `asciiContrast` | `0`–`1` | overlay strength / coverage / band crispness |
| `asciiSet` | `classic` `code` `dots` `heavy` | glyph vocabulary |
| `image` | URL or data-URL | imports palette + shape field (subject to CORS) |
| `format` | `png` `jpg` `webp` | preselects the export format |
| `download` | `png` `jpg` `webp` | auto-triggers a file download after first paint |

## 2. `window.grainient` JS API

Available once the page has loaded (e.g. via Playwright `page.evaluate`, puppeteer,
or a browser-tool `javascript_exec`):

```js
grainient.get()                      // → current settings {seed, style, mode, colors, grain, ..., ratio, hasImage}
grainient.set({ style: 'waves', colors: ['#ff6a00', '#1a1a40'], grain: 0.7, ratio: '4:5' })
grainient.lucky()                    // new palette + layout (respects current mode)
grainient.shuffle()                  // new layout, same palette
grainient.back()                     // undo — restore the previous gradient (← / ⌫ in the UI)
grainient.forward()                  // redo — replay undone gradients; new lucky when the queue is empty (→)
grainient.export('webp')             // → data URL string at 2880px long edge (sync)
grainient.export('jpg', 1200)        // custom size
grainient.download('png')            // trigger a real file download
await grainient.fromImage(url)       // import palette + shape from an image URL, returns colors
await grainient.fromImage(url, false) // palette only, keep current style
```

`set` accepts partial `ascii` objects too: `grainient.set({ ascii: { enabled: true, size: 18 } })`.

### Grab an image in one shot (Playwright example)

```js
const dataUrl = await page.evaluate(() => {
  grainient.set({ style: 'mesh', mode: 'dark', seed: 42, ratio: '16:9', grain: 0.6 })
  return grainient.export('webp')
})
// strip "data:image/webp;base64," and write the rest to a file
```

## Determinism

Rendering is fully seeded: identical `{seed, style, mode, colors, grain, softness,
vignette, ascii, ratio}` always produce pixel-identical output, and the preview matches
the export. Randomness only enters through `lucky()`/`shuffle()` (which pick a new seed).

## Style cheat-sheet

- `mesh` — soft directionless color-blob field (the signature look)
- `bloom` — composed corner glows over an anchor field
- `rise` / `set` — a radial dome anchored to the bottom / top edge, varied position, width, and squash
- `waves` — stacked rippling ridges that blend into each other, like layered hills
- `horizon` — soft strata with a squashed sun-glow near the brightest edge
- `beams` — long streaks sharing one dominant diagonal
- `spotlight` — near-black stage with a hot squashed beam of light
- `linear` / `radial` — classic directional fades (radial always orders colors by luminance for a clean glow)
- `image` — uses a dropped/imported image as the gradient's color field (its "shape")
