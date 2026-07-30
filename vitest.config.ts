import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// One test run across both packages, from the repo root.
//
// The alias is the load-bearing part. `@driftbox/engine` resolves through the workspace
// symlink to the package's `exports`, which points at dist/ — so without this, the app's
// tests would either fail on a fresh checkout or, worse, quietly pass against a stale
// build. Tests should read the source they are testing.

export default defineConfig({
  resolve: {
    alias: {
      '@driftbox/engine': fileURLToPath(new URL('./packages/engine/src/index.ts', import.meta.url)),
      '@driftbox/rack': fileURLToPath(new URL('./packages/rack/src/index.ts', import.meta.url)),
    },
  },
  // The two constants the app's build injects. Defined here as well so that anything importing
  // `version.ts` — today its own test, tomorrow a component test that renders a footer — resolves
  // them instead of dying on a ReferenceError nobody would connect to a Vite `define`.
  //
  // Fixed values rather than the real ones on purpose: a test asserting on the version of whatever
  // happened to be checked out would fail on every release, and one asserting on the commit would
  // fail on every commit.
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
    __APP_COMMIT__: JSON.stringify('testsha'),
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/*.test.ts'],
  },
})
