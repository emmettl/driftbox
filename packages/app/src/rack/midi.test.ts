import { describe, expect, it } from 'vitest'
import { midiTargets, MonoVoice } from './midi.js'

// The note-priority rule, tested as arithmetic on note numbers. It is split away from the Web MIDI plumbing
// for exactly this reason — the rule is where the behaviour anybody would notice lives, and the plumbing is
// three lines of subscription that cannot be tested in Node anyway.

describe('one voice from a keyboard', () => {
  it('opens the gate on a note and closes it on the release', () => {
    const voice = new MonoVoice()
    expect(voice.down(60, 1)).toEqual({ note: 60, gate: 1, velocity: 1 })
    expect(voice.up(60)).toEqual({ note: 60, gate: 0, velocity: 0 })
  })

  it('takes the newest key while several are held', () => {
    // Last-note priority. The alternative — lowest or highest — makes a trill play one note.
    const voice = new MonoVoice()
    voice.down(60, 1)
    expect(voice.down(67, 0.5)).toMatchObject({ note: 67, gate: 1 })
    expect(voice.down(64, 0.5)).toMatchObject({ note: 64, gate: 1 })
  })

  it('returns to a key still held when the newer one is released', () => {
    // Legato: the gate stays open throughout, which is what makes a glide knob mean anything and is the
    // same behaviour the engine's 303 keyboard has.
    const voice = new MonoVoice()
    voice.down(60, 1)
    voice.down(67, 1)
    expect(voice.up(67)).toEqual({ note: 60, gate: 1, velocity: 1 })
  })

  it('keeps the gate open for the whole of a legato passage', () => {
    // The failure this prevents is a stutter on every overlap, which reads as a bug to anybody who plays.
    const voice = new MonoVoice()
    const gates: number[] = []
    voice.down(60, 1)
    voice.down(62, 1)
    gates.push(voice.up(60)!.gate)
    voice.down(64, 1)
    gates.push(voice.up(62)!.gate)
    expect(gates).toEqual([1, 1])
    expect(voice.up(64)).toMatchObject({ gate: 0 })
  })

  it('remembers the pitch through the release', () => {
    // An envelope's release tail should decay at the pitch it was played at, not slide somewhere on the way
    // out.
    const voice = new MonoVoice()
    voice.down(72, 1)
    expect(voice.up(72)).toMatchObject({ note: 72, gate: 0 })
  })

  it('treats a repeated note-on as a retrigger rather than a second key', () => {
    // Some keyboards send them. A stack that grew would never empty, and the gate would never fall again.
    const voice = new MonoVoice()
    voice.down(60, 1)
    voice.down(60, 0.4)
    expect(voice.down(60, 0.9)).toEqual({ note: 60, gate: 1, velocity: 0.9 })
    expect(voice.up(60)).toMatchObject({ gate: 0 })
  })

  it('ignores a release for a key that was never down', () => {
    // Null rather than a spurious gate-off, which would cut a note somebody else's channel was playing.
    const voice = new MonoVoice()
    voice.down(60, 1)
    expect(voice.up(64)).toBeNull()
    expect(voice.up(60)).toMatchObject({ gate: 0 })
  })

  it('carries velocity from the key that is sounding', () => {
    const voice = new MonoVoice()
    voice.down(60, 0.25)
    expect(voice.down(67, 0.9)).toMatchObject({ velocity: 0.9 })
    // Back to the held key, at the velocity it was played with.
    expect(voice.up(67)).toMatchObject({ note: 60, velocity: 0.25 })
  })

  it('drops everything on a panic', () => {
    const voice = new MonoVoice()
    voice.down(60, 1)
    voice.down(67, 1)
    expect(voice.allOff()).toMatchObject({ gate: 0 })
    // And is usable afterwards rather than wedged.
    expect(voice.down(72, 1)).toMatchObject({ note: 72, gate: 1 })
  })

  it('starts closed, on a note that is not silence', () => {
    // The gate has to be shut or a patch opens with a note stuck on; the note has to be something, because
    // the module divides by twelve and 0 would be five octaves below C2.
    const voice = new MonoVoice()
    expect(voice.allOff()).toEqual({ note: 36, gate: 0, velocity: 0 })
  })
})

describe('choosing which MIDI modules hear a note', () => {
  // Pure so it can be tested at all: Chrome refuses Web MIDI under automation — permission is denied whatever
  // the driver grants — so the handler wrapped around this cannot be driven in a browser. Extracting the rule
  // leaves one untestable line instead of an untestable rule.
  const modules = [
    { id: 'omni', type: 'midi' },
    { id: 'ch1', type: 'midi', params: { channel: 1 } },
    { id: 'ch10', type: 'midi', params: { channel: 10 } },
    { id: 'osc', type: 'vco' },
  ]

  it('sends to a module set to that channel, and to omni', () => {
    expect(midiTargets(modules, 1)).toEqual(['omni', 'ch1'])
    expect(midiTargets(modules, 10)).toEqual(['omni', 'ch10'])
  })

  it('sends only to omni on a channel nobody wants', () => {
    expect(midiTargets(modules, 7)).toEqual(['omni'])
  })

  it('treats a missing channel param as omni', () => {
    // Which is the default, so a MIDI module dropped into a patch plays immediately rather than looking broken.
    expect(midiTargets([{ id: 'fresh', type: 'midi' }], 16)).toEqual(['fresh'])
  })

  it('never sends to a module that is not a MIDI module', () => {
    expect(midiTargets(modules, 1)).not.toContain('osc')
    expect(midiTargets([{ id: 'osc', type: 'vco' }], 1)).toEqual([])
  })

  it('is empty for a patch with no MIDI module in it', () => {
    expect(midiTargets([], 1)).toEqual([])
  })

  it('sends to both of two modules sharing a channel', () => {
    // Two modules on one channel is a legal thing to want — the same keyboard driving two voices.
    const pair = [
      { id: 'a', type: 'midi', params: { channel: 3 } },
      { id: 'b', type: 'midi', params: { channel: 3 } },
    ]
    expect(midiTargets(pair, 3)).toEqual(['a', 'b'])
  })
})
