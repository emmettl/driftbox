import { fileURLToPath } from 'node:url'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// One test run across every package, in two projects.
//
// The alias is the load-bearing part of both. `@driftbox/engine` resolves through the workspace
// symlink to the package's `exports`, which points at dist/ — so without this, the app's
// tests would either fail on a fresh checkout or, worse, quietly pass against a stale
// build. Tests should read the source they are testing.
//
// The BROWSER project exists because the thing this repo is has never been testable in Node.
// `OfflineAudioContext` is a browser API, and it is not a detail at the edge — it is where the
// audio is. Six comments across the source say some version of "the render itself is checked in a
// browser", and until now that meant checked by hand: `docs/VERIFYING-AUDIO.md` is a page of
// measurements somebody has to remember to re-run, and `ROADMAP.md` asks for exactly that after any
// change to a voice, `render.ts` or the bus. Three real level bugs came out of those measurements
// and every one of them was invisible to `npm test`.
//
// So the measurements that are numeric — a peak, a spread, whether the ladder worklet loaded —
// stop being a checklist item and become assertions. What is left in the doc is the part that
// genuinely needs a person: judging whether a kick sounds like a kick.
//
// It is Vite's own dev server driving real Chromium, not a second test runner: the same config,
// the same aliases, the same `npm test`.

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
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['packages/*/src/**/*.test.ts', 'packages/*/*.test.ts'],
          // `.browser.test.ts` DOES match the include above — the two differ by an infix, not by
          // an extension — so this exclude is the only thing keeping a browser test from being run
          // in Node with no browser in it, where every measurement in it would die on a missing
          // `OfflineAudioContext`.
          exclude: ['**/node_modules/**', '**/dist/**', '**/*.browser.test.*'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['packages/*/src/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            provider: playwright({
              // Undefined unless somebody sets it, which is the normal case: Playwright then uses
              // the Chromium `npx playwright install chromium` put where it expects. The escape
              // hatch is for a machine that already has a Chrome and would rather not download a
              // second one — and for a sandbox that cannot reach the download at all, which is
              // where these tests were first run.
              launchOptions: { executablePath: process.env.DRIFTBOX_CHROMIUM },
            }),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})

// A note for whoever adds the first browser test of a COMPONENT rather than of audio: this project
// inherits the aliases and defines above, which is everything the engine and rack need, but no
// React plugin — so a `.browser.test.tsx` will not compile under it. Give that its own project
// with `extends: './packages/app/vite.config.ts'`, which carries the plugin along with the same
// aliases. Kept out of here until there is such a test, rather than configured for a file that
// does not exist.
