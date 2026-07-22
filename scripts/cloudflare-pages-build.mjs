import { access, readdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const client = join(dist, 'client')

async function exists(path) {
  try {
    await access(path)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function clean() {
  await rm(dist, { recursive: true, force: true })
}

async function verify() {
  const required = ['index.html', 'embed.js', 'agents.md', 'llms.txt']
  const missing = []

  for (const file of required) {
    if (!(await exists(join(client, file)))) missing.push(`dist/client/${file}`)
  }

  if (missing.length > 0) {
    throw new Error(`Cloudflare Pages output is incomplete: ${missing.join(', ')}`)
  }

  const forbidden = [
    ['functions', 'Pages Functions source directory'],
    ['wrangler.json', 'Workers configuration'],
    ['wrangler.jsonc', 'Workers configuration'],
    ['wrangler.toml', 'Workers configuration'],
    ['dist/server', 'Workers server bundle'],
    ['dist/client/_worker.js', 'Pages advanced-mode Worker'],
  ]

  for (const [path, description] of forbidden) {
    if (await exists(join(root, path))) {
      throw new Error(`${description} found at ${path}; grainient must remain a static Pages deployment`)
    }
  }

  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const packages = { ...packageJson.dependencies, ...packageJson.devDependencies }
  if (packages['@cloudflare/vite-plugin']) {
    throw new Error('@cloudflare/vite-plugin targets Workers builds and must not be used for this Pages deployment')
  }

  const outputEntries = await readdir(dist)
  const unexpected = outputEntries.filter((entry) => entry !== 'client' && entry !== '.openai')
  if (unexpected.length > 0) {
    throw new Error(`Unexpected deployment output outside dist/client: ${unexpected.join(', ')}`)
  }

  console.log('Cloudflare Pages build verified: static assets are ready in dist/client')
}

const command = process.argv[2]

if (command === 'clean') {
  await clean()
} else if (command === 'verify') {
  await verify()
} else {
  throw new Error('Expected "clean" or "verify"')
}
