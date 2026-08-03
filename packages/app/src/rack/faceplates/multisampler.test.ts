import { MODULES, packMultisampleZones } from '@driftbox/rack'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Multisampler } from './Multisampler.js'

describe('the multisample faceplate', () => {
  it('turns zone metadata into an editable key map', () => {
    const def = MODULES.multisampler
    const markup = renderToStaticMarkup(
      createElement(Multisampler, {
        def,
        module: {
          id: 'keys',
          type: 'multisampler',
          data: {
            zones: packMultisampleZones([{
              root: 48,
              low: 48,
              high: 59,
              velocityLow: 0,
              velocityHigh: 0.5,
              loopStart: 0.2,
              loopEnd: 0.8,
              loop: true,
              sampleRate: 48_000,
            }]),
          },
        },
        value: (id: string) => def.params.find((param) => param.id === id)?.default ?? 0,
        onChange: () => {},
      }),
    )

    expect(markup).toContain('C3 to B3')
    expect(markup).toContain('sustain loop')
    expect(markup).toContain('Loop start')
    expect(markup).toContain('session audio unavailable')
  })
})
