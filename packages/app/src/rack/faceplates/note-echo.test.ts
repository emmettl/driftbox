import { MODULES } from '@driftbox/rack'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NoteEcho } from './NoteEcho.js'

describe('the Note Echo faceplate', () => {
  it('shows the portable repeat pattern as pitch and velocity-aware pulses', () => {
    const def = MODULES['note-echo']
    const steps = Array.from({ length: 17 }, () => 1)
    steps[2] = 0
    const markup = renderToStaticMarkup(
      createElement(NoteEcho, {
        def,
        module: { id: 'echo', type: 'note-echo', data: { steps } },
        value: (id: string) => ({ repeats: 3, pitch: 2, velocity: 0.8 }[id] ?? def.params.find((p) => p.id === id)?.default ?? 0),
        onChange: () => {},
      }),
    )

    expect(markup).toContain('Echo Matrix')
    expect(markup).toContain('Repeat 1 enabled, +2 semitones, 80% velocity')
    expect(markup).toContain('Repeat 2 muted, +4 semitones, 60% velocity')
    expect(markup).toContain('Repeat 4 enabled, +8 semitones, 20% velocity')
    expect(markup).toContain('disabled')
  })
})
