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
- **Share seeds** — every gradient is one copy-pasteable line (`grainient:v1?…`); paste a seed to recreate it exactly
- **HTML export** — download a self-contained html/css embed whose canvas re-renders to fit any container size
- **Page builder** — stitch gradients into one scrollable page with cross-faded seams; view it on the stage, export as one html file or share it as a page seed

AI agents: drive it headlessly with URL params, shareable seeds, or `window.grainient` —
see [public/agents.md](public/agents.md) (served at `/agents.md` on the deployed site, runtime at `/embed.js`).
For working on this codebase, see [AGENTS.md](AGENTS.md).
