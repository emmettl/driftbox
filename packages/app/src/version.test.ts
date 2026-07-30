import { describe, expect, it } from 'vitest'
import { COMMIT, VERSION, buildLabel, buildTitle } from './version.js'

// Small, but it covers the one case nobody will ever see while developing: a build with no git
// repository behind it, which is what an npm tarball is. That path only runs for somebody who
// installed the package, so a bug in it would be invisible here and visible only to them.

describe('the build label', () => {
  it('reads the constants the build injects', () => {
    // The fixed values from `vitest.config.ts` — deliberately not the real ones, or this test would
    // fail on every release and every commit.
    expect(VERSION).toBe('0.0.0-test')
    expect(COMMIT).toBe('testsha')
  })

  it('shows the version and the commit when there is one', () => {
    expect(buildLabel('1.2.3', 'a1b2c3d')).toBe('v1.2.3 · a1b2c3d')
  })

  it('shows the version alone when there is no commit', () => {
    // An npm tarball has no repository to ask. Inventing a commit would be worse than omitting one,
    // and a trailing separator with nothing after it would look like something failed to load.
    expect(buildLabel('1.2.3', '')).toBe('v1.2.3')
  })

  it('spells out what the second half is, for the tooltip', () => {
    expect(buildTitle('1.2.3', 'a1b2c3d')).toContain('commit a1b2c3d')
    expect(buildTitle('1.2.3', '')).toBe('Driftbox 1.2.3')
  })
})
