// Bundles src/embed-entry.ts into a self-contained IIFE, exposed two ways:
//   - `import embedRuntime from 'virtual:grainient-embed'` (inlined into HTML exports)
//   - GET /embed.js (hot-linkable from other sites)
// The agent docs at /agents.md and /llms.txt are plain files in public/.

import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'

const VIRTUAL = 'virtual:grainient-embed'
const RESOLVED = '\0' + VIRTUAL

/** files the embed bundle is built from — editing them invalidates the cache */
const EMBED_SOURCES = ['embed-entry.ts', 'engine.ts', 'code.ts', 'palette.ts', 'stitch.ts']

export function embed(): Plugin {
  let root = process.cwd()
  let cache: Promise<string> | null = null

  const bundle = (): Promise<string> => {
    cache ??= (async () => {
      const { build } = await import('vite')
      const out = await build({
        configFile: false,
        root,
        logLevel: 'warn',
        build: {
          write: false,
          minify: true,
          lib: {
            entry: resolve(root, 'src/embed-entry.ts'),
            formats: ['iife'],
            name: 'GrainientEmbed',
          },
        },
      })
      for (const b of Array.isArray(out) ? out : [out]) {
        if ('output' in b) {
          for (const chunk of b.output) {
            if (chunk.type === 'chunk') return chunk.code as string
          }
        }
      }
      throw new Error('grainient embed bundle produced no output')
    })()
    return cache
  }

  return {
    name: 'grainient-embed',
    configResolved(config) {
      root = config.root
    },
    resolveId(id) {
      if (id === VIRTUAL) return RESOLVED
    },
    async load(id) {
      if (id !== RESOLVED) return
      return `export default ${JSON.stringify(await bundle())}`
    },
    handleHotUpdate(ctx) {
      if (EMBED_SOURCES.some((f) => ctx.file.endsWith('/src/' + f))) cache = null
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if ((req.url ?? '').split('?')[0] !== '/embed.js') return next()
        try {
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
          res.end(await bundle())
        } catch (e) {
          next(e)
        }
      })
    },
    async closeBundle() {
      // runs once per build environment; only act when the client output exists
      const client = resolve(root, 'dist', 'client')
      const outDir = existsSync(client) ? client : resolve(root, 'dist')
      if (!existsSync(outDir)) return
      await writeFile(resolve(outDir, 'embed.js'), await bundle())
    },
  }
}
