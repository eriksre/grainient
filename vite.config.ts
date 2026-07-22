import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sites } from './build/sites-vite-plugin.js'
import { embed } from './build/embed-vite-plugin.js'

export default defineConfig({
  plugins: [react(), sites(), embed()],
  build: {
    outDir: 'dist/client',
  },
})
