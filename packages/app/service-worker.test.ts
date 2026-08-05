import { describe, expect, it } from 'vitest'
import { cacheName, precacheUrls, serviceWorkerSource } from './build/service-worker.ts'

// The offline copy, held to the things that break it silently.
//
// Every assertion here is a failure with a name, and none of them shows up as an error in the app.
// An absolute precache URL works perfectly on the machine that built it and caches nothing on
// GitHub Pages. A `skipWaiting()` added by somebody tidying up works perfectly until the first
// deploy that lands while a tab is open. A cache key that forgets the commit works perfectly until
// the second push of the day.

describe('precacheUrls', () => {
  it('is relative, because one build is served from two roots', () => {
    const urls = precacheUrls(['index.html', 'assets/main-a1b2c3.js'])
    // The whole reason `base` is './'. An absolute list pins the worker to one deployment, and
    // because addAll is atomic the others get no cache at all rather than a partial one.
    expect(urls.every((url) => url.startsWith('./'))).toBe(true)
    expect(urls).not.toContain('/index.html')
  })

  it('caches the directory as well as the file behind it', () => {
    // Somebody arriving at /driftbox/ makes a request that a cached ./index.html does not answer.
    expect(precacheUrls(['index.html'])).toEqual(['./', './index.html'])
  })

  it('leaves out source maps and the link-preview cards', () => {
    const urls = precacheUrls([
      'index.html',
      'assets/main-a1b2c3.js',
      'assets/main-a1b2c3.js.map',
      'og.png',
      'og-rack.png',
      'icon-192.png',
    ])
    expect(urls).toEqual(['./', './assets/main-a1b2c3.js', './icon-192.png', './index.html'])
  })

  it('does not list anything twice', () => {
    // public/ is read separately from the bundle, and nothing says a name cannot appear in both.
    // addAll on a duplicate is merely wasteful, but the list is also what the size of the offline
    // copy is judged by.
    const urls = precacheUrls(['icon-192.png', 'icon-192.png'])
    expect(urls).toEqual(['./', './icon-192.png'])
  })
})

describe('cacheName', () => {
  it('changes when the commit changes, not only when the version does', () => {
    // Pages redeploys on every push while the version moves only at a release. Keyed on the
    // version alone, every deploy between two releases would serve the first one's assets.
    expect(cacheName('0.5.0', 'aaaaaaa')).not.toBe(cacheName('0.5.0', 'bbbbbbb'))
  })

  it('falls back to the version alone when there is no commit', () => {
    // An npm tarball has no git repository. That build is immutable anyway.
    expect(cacheName('0.5.0', '')).toBe('driftbox-0.5.0')
  })

  it('stays inside the namespace activate sweeps', () => {
    // activate deletes every `driftbox-` cache that is not the current one. A key outside that
    // prefix would never be swept and would sit in the user's quota for ever.
    expect(cacheName('0.5.0', 'abc1234').startsWith('driftbox-')).toBe(true)
  })
})

describe('serviceWorkerSource', () => {
  const source = serviceWorkerSource('driftbox-0.5.0-abc1234', ['./', './index.html'])

  it('does not take over from a worker that is still being used', () => {
    // The one line whose ABSENCE is the feature. With the scenes loading on demand, a worker that
    // claimed a running page would serve it the new cache, which does not contain the chunk hashes
    // that page is about to ask for.
    expect(source).not.toContain('skipWaiting')
  })

  it('claims on first install, where there is nothing to conflict with', () => {
    expect(source).toContain('clients.claim()')
  })

  it('only sweeps its own caches', () => {
    expect(source).toContain("key.startsWith('driftbox-')")
    expect(source).toContain('key !== CACHE')
  })

  it('leaves everything that is not a same-origin GET alone', () => {
    expect(source).toContain("request.method !== 'GET'")
    expect(source).toContain('self.location.origin')
  })

  it('carries the name and the list it was given', () => {
    expect(source).toContain('"driftbox-0.5.0-abc1234"')
    expect(source).toContain('"./index.html"')
  })

  it('is valid JavaScript', () => {
    // Generated source is the one kind that no editor, linter or typechecker in this repo ever
    // looks at: it exists only after a build, in dist/. A syntax error in it would first be seen
    // by a browser, as an app that quietly never caches.
    expect(() => new Function(source)).not.toThrow()
  })
})
