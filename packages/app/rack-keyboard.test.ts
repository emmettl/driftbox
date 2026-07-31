import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RackKeys } from './src/rack/RackKeys.js'

const styles = readFileSync(new URL('./src/rack/rack.css', import.meta.url), 'utf8')
const callbacks = {
  onOpenChange: vi.fn(),
  wake: vi.fn(async () => false),
  down: vi.fn(),
  up: vi.fn(),
  allOff: vi.fn(),
  sounding: [],
}

describe('the rack keyboard dock', () => {
  it('keeps an accessible toggle when the keyboard is closed', () => {
    const open = renderToStaticMarkup(createElement(RackKeys, { ...callbacks, open: true }))
    const closed = renderToStaticMarkup(createElement(RackKeys, { ...callbacks, open: false }))

    expect(open).toContain('aria-expanded="true"')
    expect(open).toContain('Hide keyboard')
    expect(open).toContain('id="rack-keyboard"')
    expect(closed).toContain('aria-expanded="false"')
    expect(closed).toContain('Show keyboard')
    expect(closed).toContain('aria-hidden="true"')
    expect(closed).toContain('inert=""')
  })

  it('slides the keyboard and removes its reserved rack space when closed', () => {
    expect(styles).toContain("grid-template-rows: 0fr")
    expect(styles).toContain("transform: translateY(18px)")
    expect(styles).toContain(".rk[data-keyboard='closed']")
    expect(styles).toContain("--keys-offset: var(--keys-toggle-height)")
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
