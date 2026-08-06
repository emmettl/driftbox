# Publishing

Three packages go to npm: `@driftbox/engine` and `@driftbox/app`, both published at `0.6.0`,
and `@driftbox/rack`, published at `0.1.0`. **Nothing publishes automatically** — the workflow
only runs when a GitHub Release is published, or when somebody runs it by hand.

The rack is on `0.x` on purpose rather than because it is unfinished. Its capability ledgers
are complete and its public surface is tiered and pinned by `api.test.ts`; what is unsettled
is whether audio enters the document, which `REASON-GAP.md` records as the last architectural
gap and which could want a new shape in `Patch` rather than another optional field. `1.0.0` is
for when that is answered.

That is deliberate. `npm unpublish` is heavily restricted after 72 hours, so a bad version
is effectively permanent: the remedy is a new version with the broken one sitting on the
registry forever. The trigger should be something you had to go and do.

## Authentication

Every package uses npm trusted publishing. The npm package settings trust this repository's
publish workflow, and GitHub's `id-token: write` permission supplies a short-lived OIDC
credential for each run. There is no `NPM_TOKEN` secret to create, rotate or accidentally
override the OIDC path.

**A package's first publish is the exception**, and worth writing down because the next new
package will hit it too. Trusted publishing cannot be configured for a name that does not exist
on the registry yet, so a package's own first release is the one release it cannot authenticate
for. The engine hit this at `0.1.0` and the rack hit it again at `0.1.0`; both were bootstrapped
from a temporary `NPM_TOKEN` secret that was revoked immediately afterwards.

Two things about that bootstrap are worth keeping if it is ever needed again.

Scope the token to the one package that needs it, inside the publish loop, rather than setting
`NODE_AUTH_TOKEN` for the step. npm prefers an explicit token over OIDC, so a token in scope for
every package silently takes over the publishes that were working fine — and fails them outright
if it turns out to be granted for the new package alone.

And do it in the workflow rather than by hand, because that is what keeps the ordering right. The
rack depends on the engine, and publishing it before that version of the engine exists leaves an
installable tarball whose install fails; it has to go out *after* the engine and *before* the app,
which is the order the workflow already publishes in. Leaving the new package to simply fail is
not an option either: the loop runs under `set -e`, so it would take everything after it down and
half-ship the release.

`publishConfig.access` is `public` in all three packages. A scoped package defaults to
*private*, and a publish without that setting fails with a payment-required error that reads
like a billing problem rather than a missing option.

## Releasing

1. Bump the version in whichever package changed —
   `npm version <patch|minor|major> --workspace @driftbox/engine`. They version
   independently; there is no requirement to keep them in step.
2. Merge that to `main`.
3. Cut a GitHub Release tagged `v<version>`.

The workflow then lints, type-checks, tests and builds before anything leaves the machine,
checks the tag matches at least one package's version, and publishes each package that is
not already on the registry.

**Try it first.** Run the workflow manually from the Actions tab with **dry run** left
ticked — the default. It does everything except the upload, including the real
`npm publish --dry-run` output, so you can see exactly what would go out.

## What ships

| | contents |
|---|---|
| `@driftbox/engine` | `dist/` (JS + `.d.ts` + maps), `src/` without tests, README |
| `@driftbox/rack` | `dist/` (JS + `.d.ts` + maps), `src/` without tests, `examples/`, README |
| `@driftbox/app` | `dist/` (the built app), `bin/`, README |

The engine and the rack ship their **source** as well as their build, because the maps point
at it — without it they dangle and "go to definition" lands nowhere — and because the
reasoning in these packages lives in their comments. For the rack that is load-bearing twice
over: a module's processor is read as text at runtime and its comments are the DSP argument.

`@driftbox/rack` depends on `@driftbox/engine` at `^0.6.0`, for the shared ladder and the
Song codec it refuses to fork. That is why `PACKAGES` in the workflow lists the engine first:
publishing a package before the version it depends on exists leaves an installable tarball
whose install fails. The engine and the app have no runtime dependency at all.

## Provenance

Published with `--provenance`, which attaches a signed attestation linking the tarball to
the commit and workflow run that built it. npm shows it as a "Provenance" panel on the
package page. It needs `id-token: write` (set in the workflow) and a public repo.

Trusted publishing could not be configured until the package names existed, so version
`0.1.0` was bootstrapped with a token. The workflow now has no token fallback by design:
npm prefers an explicit token over OIDC, so a stale secret could turn a valid release into
a 401.

## If a publish goes wrong

- **Within 72 hours** `npm unpublish <pkg>@<version>` works, but only if nothing depends on
  it. Do not rely on this.
- **After 72 hours** publish a fixed version. You can `npm deprecate <pkg>@<version> "..."`
  to warn people off the bad one.
- **Never reuse a version number.** npm will refuse, and it is the reason the workflow skips
  versions already on the registry rather than failing on them.
