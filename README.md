# grainient

A one-page studio for grainy, film-noise gradients — mesh blobs, waves, beams,
spotlights — with ascii-lettering overlays, light/dark/mix palettes, image-based
palettes and shapes, and high-res PNG / JPG / WebP export.

```sh
npm install
npm run dev     # → http://localhost:5173
```

- **✦ I'm feeling lucky** (or space bar) — new tasteful gradient every click
- **⌫ / ← back** — return to the previous gradient
- Drop any image onto the page to steal its palette *and* use it as the gradient's shape
- Everything is seeded and deterministic: the preview always matches the export

AI agents: drive it headlessly with URL params or `window.grainient` — see [AGENTS.md](AGENTS.md).
