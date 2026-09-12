# Hosting

Driftbox is dual-hosted at **https://driftbox.app/** (and **https://www.driftbox.app/**)
and **https://emmettl.github.io/driftbox/**. Cloudflare serves a Worker with static
assets, following Grid84's setup. Both hosts serve the sequencer at `/` and the
modular synth at `rack.html`, relative to their site root.

The Vite base remains `./`: one build works at the domain root and under
`/driftbox/`. Cloudflare owns the custom-domain DNS records and certificates through
`wrangler.jsonc`. Keep GitHub Pages configured to use GitHub Actions with **no custom
domain** and no `CNAME` file, so its independent address remains available.

This provides two independent hosting addresses; it does not automatically switch
`driftbox.app` to GitHub during a Cloudflare outage. Local songs, patches and offline
caches are browser storage scoped to each origin and do not transfer between hosts.
The canonical and link-preview URLs point to `driftbox.app`.

## CI and deployments

Pull requests run `.github/workflows/ci.yml`. On a push to `main`, or a manual run,
`deploy.yml` calls that same workflow, which runs lint, typechecks, the full Node and
Chromium suite with coverage, the production build, offline verification at both
URL roots, bundle-size checks, a Wrangler dry run, and offline verification through
Wrangler’s local asset router. It uploads the checked app
as `driftbox-site` with a `_release.json` identifying the commit and workflow run.

The `pages` and `worker` jobs download that same artifact and deploy independently.
Production jobs only run for `main`, including manual runs. Deployments are
serialized so an older build cannot overwrite a newer one. Cloudflare uses the
exact Wrangler version installed by `npm ci` from `package-lock.json`.

The Worker job requires a GitHub repository secret named `CLOUDFLARE_API_TOKEN`.
Create a token using Cloudflare's **Edit Cloudflare Workers** template, scoped to
this account and the **driftbox.app** zone, then save it under
[Driftbox's Actions secrets](https://github.com/emmettl/driftbox/settings/secrets/actions).
The account ID is public configuration in `wrangler.jsonc`. A missing token fails
the Worker job explicitly; GitHub Pages still deploys. Never store an interactive
Wrangler OAuth token in CI: it expires and is intended for local sign-in.

The Cloudflare dashboard Git integration is not needed: GitHub Actions owns both
deployments. No KV, database, R2 bucket or Worker script is required by this app.

## Local deployment and verification

With `npm ci` completed and an existing Wrangler login:

```sh
npm run deploy:cloudflare
```

For a manual deployment of the exact artifact from a successful main-branch check:

```sh
gh run download RUN_ID --repo emmettl/driftbox --name driftbox-site --dir /tmp/driftbox-site
npx wrangler deploy --assets /tmp/driftbox-site
```

Run from the matching checkout so the Wrangler configuration matches that build.
Use a fresh output directory for each download. A local build has no CI release
marker; the marker is added only after CI has checked the artifact.

```sh
curl -I https://driftbox.app/
curl -I https://www.driftbox.app/rack.html
curl -s https://driftbox.app/_release.json
curl -s https://emmettl.github.io/driftbox/_release.json
```

Both release markers should name the same commit. Check both app pages, the manifest,
`sw.js`, and a hashed JS asset when verifying a deployment.

## Caching and offline support

`packages/app/public/_headers` sets Cloudflare's cache policy: hashed assets are
immutable for a year, documents and the manifest revalidate, and the service worker
and release marker use `no-cache`. GitHub Pages applies its own caching policy.

Cloudflare consumes `_headers` and `_redirects` rather than serving them, so the
service-worker precache excludes both. It also excludes `_release.json`, which must
report the live deployment. This matters because a single failed precache fetch
rejects the whole offline install. Wrangler preserves `.html` URLs so the rack's
manifest shortcut and offline cache keys do not change through HTML redirects.
`_redirects` internally rewrites `/` to `/index.html` without changing the browser URL.

Cloudflare references: [static assets](https://developers.cloudflare.com/workers/static-assets/),
[custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
