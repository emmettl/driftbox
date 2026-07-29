# Publishing

Two packages go to npm: `@driftbox/engine` and `@driftbox/app`. Neither has been published
yet, and **nothing publishes automatically** — the workflow only runs when a GitHub Release
is published, or when somebody runs it by hand.

That is deliberate. `npm unpublish` is heavily restricted after 72 hours, so a bad version
is effectively permanent: the remedy is a new version with the broken one sitting on the
registry forever. The trigger should be something you had to go and do.

## One-time setup

**1. A token.** On npmjs.com, create a **Granular Access Token** scoped to the `@driftbox`
packages with *Read and write*. Add it to the repo as a secret named `NPM_TOKEN`
(`Settings → Secrets and variables → Actions`), or:

```bash
gh secret set NPM_TOKEN
```

Prefer a granular token over a classic automation token — it can be limited to these
packages, so a leak cannot touch anything else you own.

**2. That is it.** `publishConfig.access` is already `public` in both packages, so no flag
is needed. A scoped package defaults to *private*, and a first publish without that setting
fails with a payment-required error that reads like a billing problem rather than a missing
option.

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
| `@driftbox/app` | `dist/` (the built app), `bin/`, README |

The engine ships its **source** as well as its build, because the maps point at it — without
it they dangle and "go to definition" lands nowhere — and because the reasoning in this
engine lives in its comments.

Neither package has a runtime dependency.

## Provenance

Published with `--provenance`, which attaches a signed attestation linking the tarball to
the commit and workflow run that built it. npm shows it as a "Provenance" panel on the
package page. It needs `id-token: write` (set in the workflow) and a public repo.

**After the first publish**, consider switching to npm's **trusted publishing**: configure
this repo and workflow as a trusted publisher for each package on npmjs.com, and the
`NPM_TOKEN` secret can be deleted entirely — authentication becomes a short-lived OIDC
token issued per run. It cannot be set up before a package exists, which is why it is a
second step rather than the first.

## If a publish goes wrong

- **Within 72 hours** `npm unpublish <pkg>@<version>` works, but only if nothing depends on
  it. Do not rely on this.
- **After 72 hours** publish a fixed version. You can `npm deprecate <pkg>@<version> "..."`
  to warn people off the bad one.
- **Never reuse a version number.** npm will refuse, and it is the reason the workflow skips
  versions already on the registry rather than failing on them.
