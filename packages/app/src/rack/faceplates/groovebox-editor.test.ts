import {
  DEFAULT_BASS_PARAMS,
  DEFAULT_PARAMS,
  DEFAULT_SENDS,
  defaultKit,
  emptyPattern,
  type Song,
} from '@driftbox/engine'
import { describe, expect, it } from 'vitest'
import {
  arrangementView,
  automationSummary,
  bassParamsOf,
  drumParamsOf,
  focusedStep,
  grooveboxRouting,
  isBassSection,
  liveClipName,
  liveStatus,
  sectionLooping,
  selectedVoice,
  stepWindow,
  tapTarget,
  voicesOf,
  type Launch,
} from './groovebox-editor.js'

// Which sixteen steps, which step inside them, which section of the arrangement, and which row of the
// kit the knobs write to. All of it used to be derivations wedged between the `useState` calls and the
// JSX, so the only way to ask whether a 303 cursor wraps at the end of a twelve-step pattern was to open
// a browser, retain a song, and play past the end.

const song = (over: Partial<Song> = {}): Song => ({
  bpm: 130,
  swing: 0.5,
  patterns: [emptyPattern('a', 'Pattern A'), emptyPattern('b', 'Pattern B')],
  chain: [
    { pattern: 'a', repeat: 2 },
    { pattern: 'b', repeat: 4 },
  ],
  kit: defaultKit(['808.bd', '909.bd']),
  ...over,
})

describe('the page of steps', () => {
  it('shows one page for a pattern that fits in one', () => {
    const window = stepWindow(16, 0)
    expect(window.pages).toBe(1)
    expect(window.firstStep).toBe(0)
    expect(window.steps).toHaveLength(16)
  })

  it('pages a longer pattern, and leaves a short last page short', () => {
    expect(stepWindow(20, 0).pages).toBe(2)
    const last = stepWindow(20, 1)
    expect(last.firstStep).toBe(16)
    // Four real steps rather than sixteen with twelve dead ones after the end of the pattern.
    expect(last.steps).toEqual([16, 17, 18, 19])
  })

  it('clamps the page instead of correcting it, so shortening and lengthening is reversible', () => {
    // Looking at page 3 of a long pattern, then shortening it: the last page rather than an empty grid.
    expect(stepWindow(20, 3).shownPage).toBe(1)
    // The wanted page is still 3, so restoring the length restores the view.
    expect(stepWindow(64, 3).shownPage).toBe(3)
  })

  it('gives a zero-length pattern a page to be empty on', () => {
    const window = stepWindow(0, 0)
    expect(window.pages).toBe(1)
    expect(window.steps).toEqual([])
  })
})

describe('the step the controls point at', () => {
  it('clamps a drum cursor into the pattern', () => {
    expect(focusedStep(false, 0, 5, 16)).toBe(5)
    expect(focusedStep(false, 0, 40, 16)).toBe(15)
    expect(focusedStep(false, 0, -3, 16)).toBe(0)
  })

  it('wraps a 303 cursor, because the playhead writes it', () => {
    // A hosted playhead running past the end of a short pattern comes back to its first step.
    expect(focusedStep(true, 13, 0, 12)).toBe(1)
    expect(focusedStep(true, 24, 0, 12)).toBe(0)
    expect(focusedStep(true, 6.7, 0, 12)).toBe(6)
  })

  it('wraps a negative 303 cursor forwards rather than off the front', () => {
    expect(focusedStep(true, -1, 0, 16)).toBe(15)
  })
})

describe('the section being arranged', () => {
  it('reads the chain, and where each section starts', () => {
    const view = arrangementView(song(), 1)
    expect(view.shownSection).toBe(1)
    expect(view.chainStep.pattern).toBe('b')
    expect(view.sectionStart).toBe(2)
    expect(view.totalBars).toBe(6)
  })

  it('clamps past the end of a shortened chain', () => {
    expect(arrangementView(song(), 7).shownSection).toBe(1)
  })

  it('gives an unarranged song a section to edit rather than a dead row', () => {
    // An empty chain plays the first pattern forever; the clip and transport rows have to mean
    // something on exactly the songs somebody is most likely to be starting from.
    const view = arrangementView(song({ chain: [] }), 0)
    expect(view.chain).toEqual([{ pattern: 'a', repeat: 1 }])
    expect(view.chainStep.repeat).toBe(1)
    expect(view.totalBars).toBe(1)
  })
})

describe('whether the loop is this section', () => {
  it('matches a loop that is exactly the section', () => {
    expect(sectionLooping({ start: 2, bars: 4 }, 2, 4)).toBe(true)
  })

  it('rejects one that starts elsewhere or runs a different length', () => {
    expect(sectionLooping({ start: 0, bars: 4 }, 2, 4)).toBe(false)
    expect(sectionLooping({ start: 2, bars: 2 }, 2, 4)).toBe(false)
    expect(sectionLooping(null, 2, 4)).toBe(false)
    expect(sectionLooping(undefined, 0, 1)).toBe(false)
  })

  it('treats a zero-bar section as the one bar it actually loops', () => {
    expect(sectionLooping({ start: 0, bars: 1 }, 0, 0)).toBe(true)
  })
})

describe('how much automation is retained', () => {
  it('counts nothing on a song written before automation existed', () => {
    expect(automationSummary(song())).toEqual({ lanes: 0, points: 0 })
  })

  it('counts lanes and their points together', () => {
    const withLanes = song({
      automation: [
        { target: 'bpm', interpolation: 'linear', points: [{ bar: 0, index: 0, value: 0.5 }] },
        {
          target: 'swing',
          interpolation: 'hold',
          points: [
            { bar: 0, index: 0, value: 0.5 },
            { bar: 1, index: 0, value: 0.6 },
          ],
        },
      ],
    })
    expect(automationSummary(withLanes)).toEqual({ lanes: 2, points: 3 })
  })
})

describe('the live clip', () => {
  const queued: Launch = { patternId: 'b', phase: 'queued', quantization: 'bar' }
  const active: Launch = { patternId: 'b', phase: 'active', quantization: 'bar', bar: 3 }

  it('names the pattern that was launched', () => {
    expect(liveClipName(song(), queued)).toBe('Pattern B')
  })

  it('calls a null launch the song, because that is what it means', () => {
    expect(liveClipName(song(), { ...queued, patternId: null })).toBe('song')
  })

  it('falls back to the id when the pattern has been deleted underneath it', () => {
    expect(liveClipName(song(), { ...queued, patternId: 'gone' })).toBe('gone')
  })

  it('says what is coming while a launch is queued', () => {
    expect(liveStatus(song(), queued, false)).toBe('queued Pattern B · next bar')
  })

  it('mentions the written bar only while the arrangement is being written to', () => {
    expect(liveStatus(song(), active, true)).toBe('active Pattern B · written bar 4')
    expect(liveStatus(song(), active, false)).toBe('active Pattern B')
  })

  it('says the machine follows the song when nothing is launched', () => {
    expect(liveStatus(song(), undefined, true)).toBe('follows song')
  })
})

describe('which row of the kit the mix knobs write to', () => {
  it('routes a 303 as itself', () => {
    const routing = grooveboxRouting(song(), '303.a', undefined)
    expect(routing.voiceId).toBe('303.a')
    expect(routing.name).toBe('303 A')
  })

  it('routes a drum machine per lane, not per machine', () => {
    // Sending a 909 snare's reverb to the 808's kit entry is silent in the UI and audible
    // nowhere near the knob that caused it.
    const snare = voicesOf('tr909').find((voice) => voice.id === '909.sd')
    const routing = grooveboxRouting(song(), 'tr909', snare)
    expect(routing.voiceId).toBe('909.sd')
    expect(routing.name).toBe('Snare')
  })

  it('gives each machine its own colour', () => {
    expect(grooveboxRouting(song(), '303.b', undefined).colour).toBe('#ffb02e')
    expect(grooveboxRouting(song(), 'tr909', voicesOf('tr909')[0]).colour).toBe('#5ff0d0')
    expect(grooveboxRouting(song(), 'tr808', voicesOf('tr808')[0]).colour).toBe('#ff7ad9')
  })

  it('reads the defaults for a voice the song has never touched', () => {
    const routing = grooveboxRouting(song(), 'tr808', voicesOf('tr808')[0])
    expect(routing.sends).toEqual(DEFAULT_SENDS)
    expect(routing.swingOffset).toBe(0.5)
  })

  it('reports the swing a voice plays with, not the offset it carries', () => {
    const swung = song({ swing: 0.62 })
    // A neutral offset means "whatever the song says", and the readout has to say the song's number.
    expect(grooveboxRouting(swung, 'tr808', voicesOf('tr808')[0]).effectiveSwing).toBe(62)
  })
})

describe('the kit rows behind the knobs', () => {
  it('falls back to defaults rather than crashing on an unwritten voice', () => {
    expect(drumParamsOf(song(), voicesOf('tr808')[1])).toEqual(DEFAULT_PARAMS)
    expect(drumParamsOf(song(), undefined)).toEqual(DEFAULT_PARAMS)
  })

  it('reads a 303 strip only for a 303', () => {
    expect(bassParamsOf(song(), '303.a')).toEqual(DEFAULT_BASS_PARAMS)
    expect(bassParamsOf(song(), 'tr909')).toEqual(DEFAULT_BASS_PARAMS)
  })
})

describe('where a keyboard tap lands', () => {
  it('records a 303 as the section', () => {
    expect(tapTarget('a', '303.b', '808.bd')).toEqual({
      patternId: 'a',
      section: '303.b',
      voiceId: '303.b',
    })
  })

  it('records a named drum lane', () => {
    expect(tapTarget('a', 'tr909', '909.cp').voiceId).toBe('909.cp')
  })

  it("picks the machine's first lane when a machine is chosen without one", () => {
    // Otherwise a machine change would keep recording into whichever lane the last machine had.
    expect(tapTarget('a', 'tr909').voiceId).toBe('909.bd')
    expect(tapTarget('a', 'tr808').voiceId).toBe('808.bd')
  })
})

describe('the lanes of a machine', () => {
  it('lists the drum lanes of a drum machine, and none for a 303', () => {
    expect(voicesOf('tr808').every((voice) => voice.machine === 'tr808')).toBe(true)
    expect(voicesOf('303.a')).toEqual([])
  })

  it('falls back to the first lane when the wanted one is not on this machine', () => {
    const voices = voicesOf('tr808')
    expect(selectedVoice(voices, '808.cp')?.id).toBe('808.cp')
    expect(selectedVoice(voices, '909.cp')?.id).toBe('808.bd')
    expect(selectedVoice([], 'anything')).toBeUndefined()
  })

  it('knows which sections are 303s', () => {
    expect(isBassSection('303.a')).toBe(true)
    expect(isBassSection('303.b')).toBe(true)
    expect(isBassSection('tr808')).toBe(false)
    expect(isBassSection('tr909')).toBe(false)
  })
})
