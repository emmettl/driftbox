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
    // Thirty seconds rather than the default five, for both projects.
    //
    // A DSP test renders audio, and a second of audio is a second of arithmetic whatever the machine
    // is having to do at the time. The slowest one here — the reverb asserting that all four algorithms
    // die away — renders twenty-four seconds of tail through an eight-line FDN, and it timed out at 5s
    // during `npm run coverage` on CI (run 31050855030), then passed on a re-run of the same commit.
    // On a quiet laptop that test takes 0.66s under V8 coverage instrumentation, so that runner was
    // more than seven times slower than this one, and it is not alone near the wall: `survives being
    // swept`, the engine's ladder-stability test, `always dies away`, pink noise's spectrum and the
    // vocoder's band sweep all sit between 0.15s and 0.45s instrumented, which is 1–3.5s at that same
    // multiplier. Fixing only the one that happened to fail would leave five more of them a bad
    // afternoon away from doing the same.
    //
    // Nothing is given up by moving the wall. This suite is synchronous arithmetic with no I/O and no
    // timers, so the only thing a timeout can catch is a loop that does not terminate, and thirty
    // seconds catches that as surely as five — it just takes longer to say so. Set here rather than
    // per test so that the next multi-second render inherits it instead of rediscovering this.
    //
    // It matters because of where it fails: `publish.yml` runs `npm test` before it publishes, so a
    // flaky timeout is a release that aborts halfway through a set of packages that go up in order.
    testTimeout: 30_000,
    // Keep coverage useful as a map of the gaps, not a number to game. Vitest 4 only reports
    // files loaded by a test unless `include` is explicit; that default would make untouched
    // app and UI files invisible and the total look healthier than the codebase really is.
    // There is deliberately no threshold yet: the first report is a baseline, and audio quality
    // and visual behaviour still need the browser assertions and human verification described
    // above rather than a line percentage.
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}'],
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: 'coverage',
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['packages/*/src/**/*.test.ts', 'packages/*/*.test.ts'],
          // Vitest 5 creates a benchmark variant of every configured project. These benchmarks
          // exercise the Node graph deliberately, so keep them out of the browser project and
          // scope discovery to this checkout rather than any nested worktrees.
          benchmark: {
            include: ['packages/**/*.bench.ts'],
          },
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
