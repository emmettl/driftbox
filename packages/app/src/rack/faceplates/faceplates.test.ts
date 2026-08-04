import { SONGS, encodeSong } from '@driftbox/engine'
import { MODULES } from '@driftbox/rack'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { rowsForJacks } from '../layout.js'
import { Generic, faceplateFor, genericRows, sizeFor } from './index.js'
import { GrooveboxPatternEditor } from './Groovebox.js'

// The registry is sparse and there is a fallback, and that is the whole design. These are the properties
// that make it worth having rather than sixteen hand-written components.

describe('choosing a faceplate', () => {
  it('gives every module in the registry something to draw', () => {
    for (const type of Object.keys(MODULES)) {
      expect(faceplateFor(type), type).toBeTypeOf('function')
    }
  })

  it('falls back to the generic one for a module nobody has drawn', () => {
    expect(faceplateFor('mixer')).toBe(Generic)
    expect(faceplateFor('quantizer')).toBe(Generic)
  })

  it('falls back for a module type that does not exist at all', () => {
    // Which is the case that matters for a patch from a newer build, and for third-party modules if they
    // ever happen: a faceplate without trusting anybody's markup.
    expect(faceplateFor('wavefolder')).toBe(Generic)
  })

  it('uses a hand-built faceplate where there is one', () => {
    expect(faceplateFor('vco')).not.toBe(Generic)
    expect(faceplateFor('ladder')).not.toBe(Generic)
    expect(faceplateFor('groovebox')).not.toBe(Generic)
    expect(faceplateFor('multisampler')).not.toBe(Generic)
    expect(faceplateFor('note-echo')).not.toBe(Generic)
    expect(faceplateFor('scale-player')).not.toBe(Generic)
    expect(faceplateFor('chord-player')).not.toBe(Generic)
    expect(faceplateFor('arp')).not.toBe(Generic)
  })
})

describe('how big a module is', () => {
  const size = sizeFor(MODULES)

  it('is at least as tall as its jacks need', () => {
    // The Mixer is the case: two knobs and eight inlets, so its height comes from the back panel and not
    // from the front. Getting this wrong puts its eighth inlet on top of the module below.
    for (const type of Object.keys(MODULES)) {
      expect(size(type).rows, type).toBeGreaterThanOrEqual(rowsForJacks(MODULES[type]))
    }
    expect(size('mixer').rows).toBeGreaterThan(1)
  })

  it('is at least as tall as its controls need', () => {
    for (const type of Object.keys(MODULES)) {
      const def = MODULES[type]
      const { span, rows } = size(type)
      // Only meaningful for the generic ones; a hand-built faceplate declares its own height.
      if (faceplateFor(type) !== Generic) continue
      expect(rows, type).toBeGreaterThanOrEqual(genericRows(def, span))
    }
  })

  it('makes the sequencer tall, because eighteen params do not fit in one row', () => {
    expect(size('seq').rows).toBeGreaterThan(3)
  })

  it('compacts small generic faceplates to half width', () => {
    expect(size('delay').span).toBe(1)
    expect(size('vca').span).toBe(1)
    expect(size('clock').span).toBe(1)
    expect(size('seq').span).toBe(2)
  })

  it('compacts small hand-built faceplates only when they opt in', () => {
    expect(size('vco').span).toBe(1)
    expect(size('ladder').span).toBe(1)
    expect(size('sampler').span).toBe(2)
  })

  it('gives a module it has never heard of a size rather than throwing', () => {
    expect(size('wavefolder')).toMatchObject({ span: 2 })
    expect(size('wavefolder').rows).toBeGreaterThan(0)
  })

  it('keeps every module half or full width and nothing else', () => {
    for (const type of Object.keys(MODULES)) {
      expect([1, 2]).toContain(size(type).span)
    }
  })
})

describe('a hand-built faceplate still shows everything its module has', () => {
  // The one hazard of the escape hatch, and it bit. `pan` was added to `OUT_MODULE` and simply did not
  // appear: the Out's faceplate names its params rather than walking them, so a new one is invisible until
  // somebody edits the component. The generic faceplate cannot have this problem — it walks the def.
  //
  // Rendered rather than inspected, because the question is "does a control for this param exist on screen",
  // and no amount of reading the source answers that as directly.

  const HAND_BUILT = ['groovebox', 'vco', 'ladder', 'out', 'midi', 'meter', 'arranger', 'sampler', 'multisampler', 'note-echo', 'scale-player', 'chord-player', 'arp'] as const

  /** Every param id the faceplate asked about, collected by handing it a probing `value`. */
  const asked = (type: string): Set<string> => {
    const def = MODULES[type]
    const seen = new Set<string>()
    const Faceplate = faceplateFor(type)
    renderToStaticMarkup(
      createElement(Faceplate, {
        def,
        module: { id: `${type}-1`, type },
        value: (id: string) => {
          seen.add(id)
          return def.params.find((p) => p.id === id)?.default ?? 0
        },
        onChange: () => {},
      }),
    )
    return seen
  }

  for (const type of HAND_BUILT) {
    it(`reaches every param on the ${type}`, () => {
      const def = MODULES[type]
      const seen = asked(type)
      // `hidden` params are deliberately not on the faceplate — the MIDI module's note and gate are written
      // by the host, and a knob fighting incoming MIDI is the bug that flag exists to prevent.
      const wanted = def.params.filter((p) => !p.hidden).map((p) => p.id)
      const missing = wanted.filter((id) => !seen.has(id))
      expect(missing, `${type} declares params its faceplate never shows`).toEqual([])
    })
  }
})

it('shows a live meter for every Groovebox source strip', () => {
  const def = MODULES.groovebox
  const Faceplate = faceplateFor('groovebox')
  const markup = renderToStaticMarkup(
    createElement(Faceplate, {
      def,
      module: { id: 'song', type: 'groovebox' },
      value: (id: string) => def.params.find((param) => param.id === id)?.default ?? 0,
      onChange: () => {},
    }),
  )

  expect(markup.match(/role="meter"/g)).toHaveLength(4)
  for (const name of ['808', '909', '303 A', '303 B']) {
    expect(markup).toContain(`aria-label="${name} output level"`)
  }
})

it('shows a 16-step editor for a retained Groovebox pattern', () => {
  const song = SONGS[0].build()
  const markup = renderToStaticMarkup(
    createElement(GrooveboxPatternEditor, {
      encoded: encodeSong(song),
      setPattern: () => {},
      setClip: () => {},
      setVoiceParam: () => {},
      setBassParam: () => {},
      setFlamWidth: () => {},
      setSwing: () => {},
      setVoiceSwing: () => {},
      setSend: () => {},
      setFx: () => {},
      toggleTapRecording: () => {},
      setTapTarget: () => {},
      toggleAutomationRecording: () => {},
      clearAutomation: () => {},
    }),
  )

  expect(markup).toContain('aria-label="Groovebox pattern editor"')
  expect(markup).toContain('aria-label="Pattern to edit"')
  expect(markup).toContain('aria-label="Machine to edit"')
  expect(markup).toContain('aria-label="Drum lane steps"')
  expect(markup).toContain('aria-label="Groovebox clip arrangement"')
  expect(markup).toContain('aria-label="Arrangement section"')
  expect(markup).toContain('aria-label="808 live clip"')
  expect(markup).toContain('aria-label="Clip launch quantization"')
  expect(markup).toContain('aria-label="Arm clip launch recording"')
  expect(markup).toContain('Launch ')
  expect(markup).toContain('Follow song')
  expect(markup).toContain('aria-label="Groovebox transport"')
  expect(markup).toContain('aria-label="Play from section 1"')
  expect(markup).toContain('aria-label="Loop section 1"')
  expect(markup).toContain('aria-label="Groovebox loop start bar"')
  expect(markup).toContain('aria-label="Groovebox loop length in bars"')
  expect(markup).toContain('aria-label="Groovebox pattern transforms"')
  expect(markup).toContain('aria-label="Arm Groovebox tap recording"')
  expect(markup).toContain('aria-label="Groovebox focused clipboard"')
  expect(markup).toContain('aria-label="Cut Bass Drum"')
  expect(markup).toContain('aria-label="Copy Bass Drum"')
  expect(markup).toContain('aria-label="Paste into Bass Drum"')
  expect(markup).toContain('aria-label="Groovebox automation recorder"')
  expect(markup).toContain('aria-label="Arm Groovebox automation recording"')
  expect(markup).toContain('aria-label="Groovebox swing"')
  expect(markup).toContain('aria-label="Clear Groovebox automation"')
  expect(markup).toContain('aria-label="Bass Drum sends and shared effects"')
  for (const control of ['Delay', 'Reverb', 'Swing', 'Drive', 'PCF', 'Cutoff', 'Reso', 'Env', 'Decay', 'Comp', 'Time', 'F.back', 'FX Tone', 'Size', 'Damp']) {
    expect(markup).toContain(`aria-label="${control}"`)
  }
  expect(markup).toContain('aria-label="Rotate Bass Drum left"')
  expect(markup).toContain('aria-label="Rotate Bass Drum right"')
  expect(markup).toContain('random')
  expect(markup).toContain('alter')
  expect(markup).toContain('aria-label="Bass Drum instrument controls"')
  for (const control of ['Level', 'Tune', 'Decay', 'Tone', 'Colour', 'Pan']) {
    expect(markup).toContain(`aria-label="${control}"`)
  }
  expect(markup.match(/Bass Drum step \d+: /g)).toHaveLength(16)
  expect(markup.match(/PCF step \d+: /g)).toHaveLength(16)
  expect(sizeFor(MODULES)('groovebox').rows).toBe(16)
})

it('shows every retained 303 instrument control', () => {
  const song = SONGS[0].build()
  const markup = renderToStaticMarkup(
    createElement(GrooveboxPatternEditor, {
      encoded: encodeSong(song),
      setPattern: () => {},
      setClip: () => {},
      setVoiceParam: () => {},
      setBassParam: () => {},
      setFlamWidth: () => {},
      setSwing: () => {},
      setVoiceSwing: () => {},
      setSend: () => {},
      setFx: () => {},
      toggleTapRecording: () => {},
      setTapTarget: () => {},
      toggleAutomationRecording: () => {},
      clearAutomation: () => {},
      initialSection: '303.a',
    }),
  )

  expect(markup).toContain('aria-label="303 A instrument controls"')
  expect(markup).toContain('aria-label="303 A sends and shared effects"')
  expect(markup).toContain('aria-label="Transpose 303 A down"')
  expect(markup).toContain('aria-label="Transpose 303 A up"')
  for (const control of [
    'Tune',
    'Wave',
    'Cutoff',
    'Reso',
    'Env Mod',
    'Decay',
    'Accent',
    'Level',
  ]) {
    expect(markup).toContain(`aria-label="${control}"`)
  }
})

it('shows retained 909 flam programming controls', () => {
  const song = SONGS[0].build()
  const markup = renderToStaticMarkup(
    createElement(GrooveboxPatternEditor, {
      encoded: encodeSong(song),
      setPattern: () => {},
      setClip: () => {},
      setVoiceParam: () => {},
      setBassParam: () => {},
      setFlamWidth: () => {},
      setSwing: () => {},
      setVoiceSwing: () => {},
      setSend: () => {},
      setFx: () => {},
      toggleTapRecording: () => {},
      setTapTarget: () => {},
      toggleAutomationRecording: () => {},
      clearAutomation: () => {},
      initialSection: 'tr909',
    }),
  )

  expect(markup).toContain('title="Program a second, closely spaced strike on 909 steps"')
  expect(markup).toContain('>flam</button>')
})
