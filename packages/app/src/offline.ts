// Registering the service worker, from whichever page is loading.
//
// One module for both pages, for the same reason `version.ts` is one: the sequencer and the rack
// are two documents out of one build, they share a scope, and two registrations that could
// disagree about the path would be two chances to end up with two workers.
//
// **Registered after load, not during it.** The worker's install fetches the entire precache —
// every chunk, both pages, the icons — and doing that while the page is still fetching what it
// needs to render puts the two in competition over the same connections. Nobody has ever
// benefited from the offline copy arriving four seconds sooner; plenty of people would notice
// the first paint arriving four seconds later.
//
// The path is relative for the same reason everything else here is: one build serves the Pages
// project site at `/driftbox/`, `npx @driftbox/app` at the root, and a static host at either.
// It also decides the scope — a worker registered from `./sw.js` controls its own directory and
// below, which is precisely the app and nothing else on the origin.

/** Whether this environment can have a service worker at all. */
export function supportsOffline(
  navigatorLike: { serviceWorker?: unknown } | undefined = globalThis.navigator,
): boolean {
  return Boolean(navigatorLike && 'serviceWorker' in navigatorLike && navigatorLike.serviceWorker)
}

interface RegisterOptions {
  /** False in `npm run dev`. See below. */
  enabled?: boolean
  navigator?: { serviceWorker?: { register(url: string, options?: object): Promise<unknown> } }
  /** How to defer past load. Injected so a test does not have to fire real load events. */
  afterLoad?: (run: () => void) => void
}

const onLoad = (run: () => void) => {
  if (document.readyState === 'complete') run()
  else globalThis.addEventListener('load', run, { once: true })
}

/**
 * Register the worker, unless there is a reason not to.
 *
 * **Off in dev, deliberately.** A service worker serving a precached build is the exact opposite
 * of what HMR is for, and the failure it produces is not a broken page but a page that quietly
 * ignores the edit you just made — the most expensive kind of confusion to debug, because
 * everything looks fine. `import.meta.env.DEV` is the gate, so the only way to exercise this
 * locally is `npm run preview` or `npm start`, both of which serve a real build.
 *
 * Failure is swallowed on purpose. A worker that cannot register — a private window, a host
 * without HTTPS, a browser that has them switched off — costs the user nothing except the
 * offline copy. Every one of those is a normal way to run this app, and none of them is worth an
 * error in a console that should be reporting audio problems.
 */
export function registerOffline(options: RegisterOptions = {}): void {
  const {
    enabled = !import.meta.env.DEV,
    navigator: nav = globalThis.navigator,
    afterLoad = onLoad,
  } = options

  if (!enabled || !supportsOffline(nav)) return

  afterLoad(() => {
    void nav?.serviceWorker?.register('./sw.js', { scope: './' }).catch(() => {})
  })
}
