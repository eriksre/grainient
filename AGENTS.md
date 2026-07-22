# AGENTS.md — working on this repo

grainient is a client-only React + Vite app (deployed on Cloudflare) that generates grainy, seeded, deterministic gradients. This file is for agents (and humans) editing the codebase. The guide for agents _driving the deployed app_ lives at [public/agents.md](public/agents.md), served on the site at `/agents.md`.

## Commands

```sh
npm install
npm run dev      # → http://localhost:5173
npm run build    # clean + tsc/Vite + Cloudflare Pages artifact verification → dist/client
npm run lint     # Ultracite/Oxlint/Oxfmt check
npm run lint:fix # apply safe lint and formatting fixes
```

## Map

| path | what it is |
| --- | --- |
| `src/engine.ts` | canvas render engine: color-field styles, grain, vignette, ascii overlay. Pure, seeded, DOM-only deps |
| `src/palette.ts` | palette generation (per-mode schemes, harmonizer) + image palette/shape import |
| `src/code.ts` | shareable seeds: URL-param parsing, `grainient:v1?…` encode/decode, `grainient-page:v1?blend=…` page seeds |
| `src/stitch.ts` | stitched pages: renders sections into one tall canvas with feathered seam cross-fades |
| `src/App.tsx` | the whole UI + the `window.grainient` agent API + URL-param handling |
| `src/embed-entry.ts` | standalone embed runtime: mounts `[data-grainient]` / `[data-grainient-page]` elements, re-renders on resize |
| `src/export-html.ts` | builds the self-contained HTML export (inlines the embed runtime via `virtual:grainient-embed`) |
| `build/embed-vite-plugin.ts` | bundles the embed runtime (nested vite build) → virtual module + `/embed.js` |
| `public/agents.md`, `public/llms.txt` | agent-facing site docs, served verbatim |

## Invariants — do not break these

1. **Determinism.** Identical settings at a given canvas size must render pixel-identically, and the preview must match every export. All randomness flows through `mulberry32(seed)`; never call `Math.random()` inside render paths.
2. **Seeds round-trip.** `encodeCode(decodeCode(x))` must reproduce `x` for canonical seeds. Seeds double as app URL params and as embed `data-` attributes — the three share one parser (`settingsFromParams`).
3. **Every capability ships on all surfaces.** UI control ⇄ URL param ⇄ `window.grainient` method ⇄ (where it makes sense) seed field. When you add one, add the others and document them in `public/agents.md`.
4. **The embed runtime stays self-contained.** `embed-entry.ts` may import only from `engine/code/palette/stitch`; it is bundled standalone and inlined into exports.

## Conventions

- Plain CSS in `src/index.css`, design tokens as `--vars`, lowercase UI copy.
- User-facing name for a shareable code is **seed** ("share seed", "page seed").
- Comments explain _why_, not _what_; match the existing terse style.
- After changes run `npm run build && npm run lint`; both must pass clean.
