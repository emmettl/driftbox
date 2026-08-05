import { REST, setBassStepGate, type BassStep } from '@driftbox/engine'
import { describe, expect, it } from 'vitest'
import {
  automationArmTitle,
  automationStatus,
  bassNoteReadout,
  bassStepLabel,
  bassStepState,
  fxFormat,
  pan,
  pcfStateLabel,
  percent,
  sectionName,
  stepState,
  tapArmTitle,
  wave,
} from './groovebox-format.js'

// A step grid is a grid of numbers; its labels are the only part of it a reader can hear, and the only
// part a test can read. These were nested ternaries inside JSX attributes — expressions that are never
// wrong loudly.

const note = (over: Partial<BassStep> = {}): BassStep => ({
  note: 12,
  accent: false,
  slide: false,
  ...over,
})

describe('naming the machines', () => {
  it('uses the names on the machines rather than the ids in the song', () => {
    expect(sectionName('tr808')).toBe('808')
    expect(sectionName('tr909')).toBe('909')
    expect(sectionName('303.a')).toBe('303 A')
    expect(sectionName('303.b')).toBe('303 B')
  })
})

describe('drum and filter steps', () => {
  it('reads the three states of a step', () => {
    expect(stepState(0)).toBe('rest')
    expect(stepState(1)).toBe('hit')
    expect(stepState(2)).toBe('accent')
  })

  it('says the same three states the way the filter means them', () => {
    expect(pcfStateLabel(0)).toBe('off')
    expect(pcfStateLabel(1)).toBe('on')
    expect(pcfStateLabel(2)).toBe('accent')
  })
})

describe('303 steps, which have a fourth state', () => {
  it('draws a sounding note by whether it is accented', () => {
    expect(bassStepState(note())).toBe('hit')
    expect(bassStepState(note({ accent: true }))).toBe('accent')
  })

  it('draws a paused note as a rest even when it is still accented', () => {
    // A pause keeps its pitch and its flags so switching it back on restores the note. Reading the
    // accent flag first would draw a silent step as the loudest one in the bar.
    const paused = setBassStepGate(note({ accent: true }), false)
    expect(bassStepState(paused)).toBe('rest')
  })

  it('announces whether a step sounds, before its pitch', () => {
    expect(bassStepLabel(REST)).toBe('rest')
    expect(bassStepLabel(note())).toBe('note 12')
    expect(bassStepLabel(setBassStepGate(note(), false))).toBe('paused pitch 12')
  })

  it('announces the flags that shape it, in the order they are drawn', () => {
    expect(bassStepLabel(note({ accent: true }))).toBe('note 12, accent')
    expect(bassStepLabel(note({ slide: true }))).toBe('note 12, slide')
    expect(bassStepLabel(note({ accent: true, slide: true }))).toBe('note 12, accent, slide')
  })

  it('marks a held-silent pitch in the readout, and says nothing for no pitch at all', () => {
    expect(bassNoteReadout(REST)).toBe('—')
    expect(bassNoteReadout(note())).toBe('12')
    expect(bassNoteReadout(setBassStepGate(note(), false))).toBe('·12')
  })
})

describe('knob readouts', () => {
  it('rounds a proportion to a whole percentage', () => {
    expect(percent(0)).toBe('0')
    expect(percent(0.5)).toBe('50')
    expect(percent(1)).toBe('100')
  })

  it('reads pan out from the centre in both directions', () => {
    expect(pan(0.5)).toBe('C')
    expect(pan(0)).toBe('L100')
    expect(pan(1)).toBe('R100')
    expect(pan(0.25)).toBe('L50')
  })

  it('names the two 303 waves at the halfway point', () => {
    expect(wave(0.49)).toBe('saw')
    expect(wave(0.5)).toBe('sqr')
  })

  it('says "off" and "clean" rather than a zero somebody has to interpret', () => {
    expect(fxFormat.drive(0)).toBe('clean')
    expect(fxFormat.drive(0.5)).toBe('50')
    expect(fxFormat.pcfAmount(0)).toBe('off')
    expect(fxFormat.compressor(0)).toBe('off')
  })

  it('carries a unit on every effect knob that has one', () => {
    expect(fxFormat.pcfCutoff(0.5)).toMatch(/^\d+Hz$/)
    expect(fxFormat.pcfDecay(0.5)).toMatch(/^\d+ms$/)
    expect(fxFormat.delayTime(0.5)).toMatch(/^\d+\/16$/)
    expect(fxFormat.reverbSize(0)).toBe('0.3s')
    expect(fxFormat.reverbSize(1)).toBe('3.8s')
  })
})

describe('what the tap button promises', () => {
  const armed = { armed: true, bass: false, running: false, target: 'Snare', step: 0 }

  it('offers to record before it is armed', () => {
    expect(tapArmTitle({ ...armed, armed: false })).toBe(
      'Quantise rack keyboard taps into the focused Snare clip',
    )
  })

  it('admits a stopped drum machine will not record anything yet', () => {
    // Looking armed and swallowing the taps is the failure this sentence exists to prevent.
    expect(tapArmTitle(armed)).toBe(
      'Tap recording armed — start playback, then play the rack keyboard',
    )
  })

  it('says where a running drum machine is writing', () => {
    expect(tapArmTitle({ ...armed, running: true })).toBe(
      'Recording keyboard taps into Snare at the hosted playhead',
    )
  })

  it('gives a 303 both of its answers, because it has a cursor when stopped', () => {
    expect(tapArmTitle({ ...armed, bass: true, step: 5 })).toBe(
      '303 entry armed — stopped: cursor step 6; playing: hosted playhead',
    )
  })
})

describe('what the automation recorder says', () => {
  it('separates armed from recording', () => {
    expect(automationArmTitle(true, false)).toBe(
      'Automation armed — start playback, then move a supported control',
    )
    expect(automationArmTitle(true, true)).toBe(
      'Recording supported controls at the hosted song playhead',
    )
    expect(automationArmTitle(false, true)).toBe(
      'Record tempo, swing and instrument controls into the retained song',
    )
  })

  it('reports what it holds when it is not recording', () => {
    expect(automationStatus(false, false, 0, 0)).toBe('0 lanes')
    expect(automationStatus(false, false, 2, 7)).toBe('2 lanes · 7 points')
  })

  it('reports what it is doing when it is', () => {
    expect(automationStatus(true, false, 2, 7)).toBe('armed · 7 points')
    expect(automationStatus(true, true, 2, 7)).toBe('recording · 7 points')
  })
})
