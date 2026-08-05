import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { cacheName, precacheUrls, serviceWorkerSource } from './build/service-worker.ts'

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
/** Asked once. It spawns a process, and the service-worker plugin wants the same answer. */
const COMMIT = commit()

const buildDefines = {
  __APP_VERSION__: JSON.stringify(version),
  __APP_COMMIT__: JSON.stringify(COMMIT),
}

/**
 * Emit `sw.js` naming everything this build produced.
 *
 * The list has to come from the build rather than from a glob of `dist/`, because the filenames
 * carry content hashes that only exist once rolldown has decided them — and `cache.addAll` is
 * atomic, so one stale name in the list is not a missing file, it is an install that fails and
 * an app that never caches anything. `generateBundle` is the first hook that knows all of them.
 *
 * `public/` is read separately because Vite copies it verbatim and it never enters the bundle.
 * Reading the directory rather than listing the files by hand means an icon added later is
 * precached without anybody remembering to come back here.
 *
 * Build-only: a worker in dev would serve a cached build over the one being edited, which is
 * why `registerOffline` refuses to register there. `apply: 'build'` is the other half of that,
 * so nothing is even emitted for the dev server to trip over.
 */
function serviceWorker(): Plugin {
  const publicDir = fileURLToPath(new URL('./public', import.meta.url))
  return {
    name: 'driftbox-service-worker',
    apply: 'build',
    // `post`, and it is not a preference. Vite emits index.html and rack.html from its own
    // `generateBundle`, so a plugin running at normal order sees a bundle with every script and
    // stylesheet in it and neither document — a precache that caches all of the app except the
    // pages that load it, which installs cleanly and then opens nothing offline.
    enforce: 'post',
    generateBundle(_options, bundle) {
      const urls = precacheUrls([...Object.keys(bundle), ...readdirSync(publicDir)])

      // Loudly, because the failure it guards against is silent. This went wrong once already,
      // for the ordering reason above, and nothing about the build looked wrong: it succeeded,
      // the app worked online, and the offline copy was a set of assets with no document to
      // hang them on.
      const documents = urls.filter((url) => url.endsWith('.html'))
      if (documents.length < 2) {
        this.error(
          `The precache is missing a document — found ${documents.length}, expected index.html and rack.html. ` +
            'Vite emits them during generateBundle, so this plugin has to run after it.',
        )
      }

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: serviceWorkerSource(cacheName(version, COMMIT), urls),
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), serviceWorker()],

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
      output: {
        // Name the two chunks that are actually libraries.
        //
        // Left alone, a shared chunk is named after whichever of its modules the bundler happened
        // to pick, which has meant `Oscilloscope`, then `offline`, then `audio` — a file of
        // 856kB called `audio` that is in fact all of three, and a 368kB one called `offline`
        // that is React. Every one of those names is a lie about the biggest thing in the build,
        // and `offline` in particular reads as the cost of the service worker, which is 2kB.
        //
        // It is also what makes a size budget possible at all. `scripts/check-size.mjs` matches on
        // the name in front of the content hash, so a name that moves when an unrelated module is
        // added is a budget that silently stops covering anything.
        // `advancedChunks` rather than `manualChunks`: under rolldown the latter is a function
        // only, and passing it the name-to-modules object every Rollup example shows is a type
        // error rather than a silent no-op — which is the good version of that surprise.
        advancedChunks: {
          groups: [
            { name: 'three', test: /[\\/]node_modules[\\/](three|@react-three)[\\/]/ },
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
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
