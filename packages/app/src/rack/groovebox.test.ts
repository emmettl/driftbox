import { describe, expect, it } from 'vitest'
import { routedGrooveboxSections } from './groovebox.js'

const source = { id: 'song', type: 'groovebox' }
const out = { id: 'out', type: 'out' }

describe('routing retained groovebox machines', () => {
  it('diverts a section when either stereo outlet has a cable', () => {
    expect(
      routedGrooveboxSections({
        modules: [source, out],
        cables: [
          { from: ['song', 'tr808-l'], to: ['out', 'in'] },
          { from: ['song', '303.b-r'], to: ['out', 'in'] },
        ],
      }),
    ).toEqual(['tr808', '303.b'])
  })

  it('ignores matching outlet names on an unrelated module', () => {
    expect(
      routedGrooveboxSections({
        modules: [{ id: 'other', type: 'future' }, out],
        cables: [{ from: ['other', 'tr909-l'], to: ['out', 'in'] }],
      }),
    ).toEqual([])
  })
})
