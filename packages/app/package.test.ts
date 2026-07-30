import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  bin?: Record<string, string>
}

const manifest = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as PackageManifest

describe('the published app package', () => {
  it('exposes an executable npx entry point without npm normalising it', () => {
    const target = manifest.bin?.driftbox

    expect(target).toBe('bin/driftbox.js')
    if (!target) return

    const executable = new URL(target, import.meta.url)
    expect(statSync(executable).mode & 0o111).not.toBe(0)
    expect(readFileSync(executable, 'utf8').split('\n', 1)[0]).toBe('#!/usr/bin/env node')
  })
})
