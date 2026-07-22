import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { embed } from "./build/embed-vite-plugin.js";
import { sites } from "./build/sites-vite-plugin.js";

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  plugins: [react(), sites(), embed()],
});
