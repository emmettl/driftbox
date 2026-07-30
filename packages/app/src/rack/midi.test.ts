import { describe, expect, it } from 'vitest'
import { Keyboard, midiTargets, type VoiceState } from './midi.js'

// The allocation rule, tested as arithmetic on note numbers. It is split away from the Web MIDI plumbing for
// exactly this reason — the rule is where the behaviour anybody would notice lives, and the plumbing is three
// lines of subscription that cannot be tested in Node anyway.
//
// The monophonic block below is the important one. `Keyboard` replaced a separate `MonoVoice`, and these are
// that class's tests kept verbatim in behaviour: one implementation has to still feel like a mono synth at one
// voice, or polyphony arrived at the cost of the thing the rack already did well.

/** The single voice-0 change, for the monophonic cases. */
const one = (states: VoiceState[]) => {
  expect(states.length).toBeLessThanOrEqual(1)
  return states[0] ?? null
}

describe('one voice: last-note priority with legato', () => {
  it('opens the gate on a note and closes it on the release', () => {
    const kb = new Keyboard(1)
    expect(one(kb.down(60, 1))).toEqual({ voice: 0, note: 60, gate: 1, velocity: 1 })
    expect(one(kb.up(60))).toEqual({ voice: 0, note: 60, gate: 0, velocity: 0 })
  })

  it('takes the newest key while several are held', () => {
    // The alternative — lowest or highest priority — makes a trill play one note.
    const kb = new Keyboard(1)
    kb.down(60, 1)
    expect(one(kb.down(67, 0.5))).toMatchObject({ note: 67, gate: 1 })
    expect(one(kb.down(64, 0.5))).toMatchObject({ note: 64, gate: 1 })
  })

  it('returns to a key still held when the newer one is released', () => {
    // Legato, and the reason `Keyboard` is one class rather than two: an allocator that merely steals a voice
    // does not do this, and it is most of what makes a glide knob mean anything.
    const kb = new Keyboard(1)
    kb.down(60, 1)
    kb.down(67, 1)
    expect(one(kb.up(67))).toEqual({ voice: 0, note: 60, gate: 1, velocity: 1 })
  })

  it('keeps the gate open for the whole of a legato passage', () => {
    // The failure this prevents is a stutter on every overlap, which reads as a bug to anybody who plays.
    //
    // Asserted as "no gate-off was ever sent" rather than "each step reported gate 1", because only *changes*
    // are emitted — releasing an already-superseded key changes nothing, so it correctly says nothing. The
    // first version of this test expected a message and got null, which is the reporting being right.
    const kb = new Keyboard(1)
    const emitted: VoiceState[] = []
    const record = (states: VoiceState[]) => emitted.push(...states)

    record(kb.down(60, 1))
    record(kb.down(62, 1))
    record(kb.up(60))
    record(kb.down(64, 1))
    record(kb.up(62))
    expect(emitted.some((s) => s.gate === 0)).toBe(false)

    // And it does close once the last key goes.
    expect(one(kb.up(64))).toMatchObject({ gate: 0 })
  })

  it('remembers the pitch through the release', () => {
    // An envelope's release tail should decay at the pitch it was played at, not slide on the way out.
    const kb = new Keyboard(1)
    kb.down(72, 1)
    expect(one(kb.up(72))).toMatchObject({ note: 72, gate: 0 })
  })

  it('treats a repeated note-on as a retrigger rather than a second key', () => {
    // Some keyboards send them. A stack that grew would never empty, and the gate would never fall again.
    const kb = new Keyboard(1)
    kb.down(60, 1)
    kb.down(60, 0.4)
    expect(one(kb.down(60, 0.9))).toMatchObject({ note: 60, gate: 1, velocity: 0.9 })
    expect(one(kb.up(60))).toMatchObject({ gate: 0 })
  })

  it('ignores a release for a key that was never down', () => {
    const kb = new Keyboard(1)
    kb.down(60, 1)
    expect(kb.up(64)).toEqual([])
    expect(one(kb.up(60))).toMatchObject({ gate: 0 })
  })

  it('carries velocity from the key that is sounding', () => {
    const kb = new Keyboard(1)
    kb.down(60, 0.25)
    expect(one(kb.down(67, 0.9))).toMatchObject({ velocity: 0.9 })
    expect(one(kb.up(67))).toMatchObject({ note: 60, velocity: 0.25 })
  })

  it('drops everything on a panic and is usable afterwards', () => {
    const kb = new Keyboard(1)
    kb.down(60, 1)
    kb.down(67, 1)
    expect(one(kb.allOff())).toMatchObject({ gate: 0 })
    expect(one(kb.down(72, 1))).toMatchObject({ note: 72, gate: 1 })
  })
})

describe('several voices', () => {
  /** What each voice is sounding after a sequence, by replaying the changes. */
  function play(kb: Keyboard, moves: (kb: Keyboard) => VoiceState[][]): Map<number, VoiceState> {
    const state = new Map<number, VoiceState>()
    for (const batch of moves(kb)) for (const change of batch) state.set(change.voice, change)
    return state
  }

  it('puts a chord on separate voices', () => {
    // The whole point, and the thing a monophonic rack could not do.
    const kb = new Keyboard(4)
    const state = play(kb, (k) => [k.down(60, 1), k.down(64, 1), k.down(67, 1)])
    const sounding = [...state.values()].filter((s) => s.gate === 1)
    expect(sounding.map((s) => s.note).sort((a, b) => a - b)).toEqual([60, 64, 67])
    expect(new Set(sounding.map((s) => s.voice)).size).toBe(3)
  })

  it('leaves a voice alone once it has its note', () => {
    // A chord must not shuffle between voices every time another key moves, or envelopes that should be
    // sustaining get retriggered.
    const kb = new Keyboard(4)
    kb.down(60, 1)
    const first = kb.down(64, 1)
    expect(first).toHaveLength(1)
    const third = kb.down(67, 1)
    expect(third).toHaveLength(1)
    expect(third[0].voice).not.toBe(first[0].voice)
  })

  it('closes only the voice whose key was released', () => {
    const kb = new Keyboard(4)
    kb.down(60, 1)
    const second = kb.down(64, 1)
    const released = kb.up(60)
    expect(released).toHaveLength(1)
    expect(released[0]).toMatchObject({ note: 60, gate: 0 })
    expect(released[0].voice).not.toBe(second[0].voice)
  })

  it('steals the oldest voice for a note past the count', () => {
    const kb = new Keyboard(2)
    const a = kb.down(60, 1)[0]
    kb.down(64, 1)
    const stolen = kb.down(67, 1)
    // The third note lands on the voice that took the first, because it has been sounding longest.
    expect(stolen.some((s) => s.voice === a.voice && s.note === 67 && s.gate === 1)).toBe(true)
  })

  it('hands a stolen note back when the thief is released', () => {
    // What a good polysynth does, and it falls out of "sound the newest N" rather than needing a rule.
    const kb = new Keyboard(2)
    kb.down(60, 1)
    kb.down(64, 1)
    kb.down(67, 1)
    const back = kb.up(67)
    expect(back.some((s) => s.note === 60 && s.gate === 1)).toBe(true)
  })

  it('does not immediately reuse the voice it just released', () => {
    // So a release tail keeps ringing while there is somewhere else to put the new note.
    //
    // A voice that has never sounded counts as idle for longer than one just freed, which is why this is
    // phrased as "not the one just released" rather than "the first one" — the first version expected voice 0
    // to come back around and got voice 2, because voice 2 had never been touched. That is the rule working.
    const kb = new Keyboard(3)
    const first = kb.down(60, 1)[0].voice
    kb.up(60)
    const second = kb.down(64, 1)[0].voice
    kb.up(64)

    const third = kb.down(67, 1)[0].voice
    expect(third).not.toBe(second)
    expect([first, second, third].filter((v, i, all) => all.indexOf(v) === i)).toHaveLength(3)
  })

  it('silences everything when the voice count changes', () => {
    // A chord half-assigned across a changing number of voices is not worth the code to preserve, and the
    // graph is being recompiled anyway.
    const kb = new Keyboard(4)
    kb.down(60, 1)
    kb.down(64, 1)
    const changes = kb.setVoices(2)
    expect(changes.every((s) => s.gate === 0)).toBe(true)
    expect(kb.count).toBe(2)
    // And it plays afterwards.
    expect(kb.down(72, 1)).toHaveLength(1)
  })

  it('reports nothing for a voice that no longer exists', () => {
    // Shrinking from 8 to 2 must not send gate-offs to voices 2..7, which the audio thread no longer has.
    const kb = new Keyboard(8)
    for (const note of [60, 62, 64, 65, 67]) kb.down(note, 1)
    for (const change of kb.setVoices(2)) expect(change.voice).toBeLessThan(2)
  })

  it('clamps a silly voice count', () => {
    expect(new Keyboard(0).count).toBe(1)
    expect(new Keyboard(99).count).toBe(8)
    expect(new Keyboard(2.6).count).toBe(3)
  })

  it('drops a whole chord on a panic', () => {
    const kb = new Keyboard(4)
    for (const note of [60, 64, 67]) kb.down(note, 1)
    const off = kb.allOff()
    expect(off).toHaveLength(3)
    expect(off.every((s) => s.gate === 0)).toBe(true)
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
    const pair = [
      { id: 'a', type: 'midi', params: { channel: 3 } },
      { id: 'b', type: 'midi', params: { channel: 3 } },
    ]
    expect(midiTargets(pair, 3)).toEqual(['a', 'b'])
  })
})
