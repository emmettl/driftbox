import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const engineSource = fileURLToPath(new URL('../engine/src/index.ts', import.meta.url))
const rackSource = fileURLToPath(new URL('../rack/src/index.ts', import.meta.url))

export default defineConfig({
  plugins: [react()],

  // Relative, so ONE build serves every way this ships.
  //
  // GitHub Pages is a project site at /driftbox/; `npx @driftbox/app` serves from the
  // root; a copy dropped on any static host could be at either. An absolute base has to
  // pick one and be wrong for the rest, which previously meant threading BASE_PATH
  // through the deploy workflow and would have meant a second build for npm. Verified by
  // serving one dist/ at http://host/driftbox/ and http://host/ simultaneously:
  // identical, no console errors, ladder worklet loading in both.
  //
  // This does NOT affect the Open Graph tags in index.html, which are absolute and
  // hardcoded to the canonical Pages URL on purpose — crawlers cannot resolve a
  // relative og:image.
  base: './',

  // Two pages, one build. `index.html` is the sequencer and `rack.html` is the modular; they share
  // this package, its dependencies and about half its components, and share no state at runtime.
  //
  // It costs one option because `base: './'` was already relative for the reasons below — a second
  // entry point needs no second build and no path juggling, and `npx @driftbox/app` serves both.
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        rack: fileURLToPath(new URL('./rack.html', import.meta.url)),
      },
    },
  },

  resolve: {
    alias: {
      // Point at the engine's SOURCE, not its built dist.
      //
      // Without this the workspace symlink resolves @driftbox/engine through its
      // `exports` field to dist/, so every engine edit would need a rebuild before the
      // app saw it — no HMR, and a stale dist quietly serving old audio code is exactly
      // the kind of bug that costs an afternoon. Building from source also lets Vite
      // tree-shake across the package boundary.
      //
      // The published engine still ships its own dist for outside consumers; this only
      // changes how the app in this repo consumes it.
      '@driftbox/engine': engineSource,
      '@driftbox/rack': rackSource,
    },
  },
})
