import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const engineSource = fileURLToPath(new URL('../engine/src/index.ts', import.meta.url))
const rackSource = fileURLToPath(new URL('../rack/src/index.ts', import.meta.url))

const version = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
).version as string

/**
 * The commit this build came from, short. Empty when it cannot be known.
 *
 * **The version on its own does not answer the question people actually have.** Pages redeploys on
 * every push to main while the package version only moves at a release, so `0.1.0` sits unchanged
 * across dozens of deploys — "is my fix live yet?" is unanswerable from it. The commit is what makes
 * the label mean something, and it is the same identifier `docs/PUBLISHING.md` already leans on:
 * every published tarball carries an attestation naming the commit that built it.
 *
 * Falls back to empty rather than to a guess. A build from an npm tarball has no git repository, and
 * a label that invented a commit would be worse than one that omits it — `buildLabel` shows the
 * version alone in that case. `GITHUB_SHA` is not consulted: `actions/checkout` gives CI a real
 * repository, so git answers there too, and one source of truth beats two that can disagree.
 */
function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      encoding: 'utf8',
      // Never let a missing git turn a build into a hang or a wall of stderr.
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

/** Injected into both pages. Kept next to the workspace aliases because it is the same kind of thing:
 *  something the build knows and the source cannot look up for itself. */
const buildDefines = {
  __APP_VERSION__: JSON.stringify(version),
  __APP_COMMIT__: JSON.stringify(commit()),
}

export default defineConfig({
  plugins: [react()],

  define: buildDefines,

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
