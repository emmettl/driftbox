// What build am I looking at?
//
// One module for both pages, for the same reason the hash codec is one: the sequencer and the rack are
// two documents out of one package, and they ship as one build with one version. Two answers to this
// question would be two chances to be wrong about it.
//
// The values arrive as build-time constants rather than by importing `package.json`. Importing it would
// pull the whole manifest — name, scripts, every dependency — into the bundle to read one string, and
// the commit is not in there at all. `vite.config.ts` has the reasoning for both.

declare const __APP_VERSION__: string
declare const __APP_COMMIT__: string

/** The `@driftbox/app` version this was built from. */
export const VERSION = __APP_VERSION__

/** The short commit, or empty when the build had no git repository to ask — an npm tarball. */
export const COMMIT = __APP_COMMIT__

/**
 * The version as it should be shown, with the commit when there is one.
 *
 * A function rather than a constant so that a test can exercise both shapes without reaching into
 * module state — the no-commit case is the one that only happens in a published tarball, which is
 * exactly the build nobody runs locally and therefore the one worth having a test for.
 */
export function buildLabel(version = VERSION, commit = COMMIT): string {
  return commit ? `v${version} · ${commit}` : `v${version}`
}

/** The long form, for a `title`. Says what the short form's second half actually is, because "· a1b2c3d"
 *  is only obviously a commit to somebody who already knew. */
export function buildTitle(version = VERSION, commit = COMMIT): string {
  return commit ? `Driftbox ${version}, built from commit ${commit}` : `Driftbox ${version}`
}
