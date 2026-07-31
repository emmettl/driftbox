// Web MIDI, and the note-priority rule that turns a keyboard into one or more voices.
//
// Two halves, deliberately split. `MonoVoice` is the rule and knows nothing about the browser, so it is
// tested here as plain arithmetic on note numbers. `openMidi` is the plumbing, which is untestable in Node
// and is correspondingly thin — it asks for access, subscribes, and forwards bytes.
//
// The rack's audio thread cannot do any of this itself: an `AudioWorkletGlobalScope` has no `navigator`. See
// the comment at the top of `@driftbox/rack`'s `modules/midi.ts` for why that needed no new message anyway.

/** One voice's worth of what the MIDI module's hidden params should be set to. */
export interface VoiceState {
  voice: number
  note: number
  gate: 0 | 1
  velocity: number
}

/**
 * A keyboard, allocated across one or more voices.
 *
 * **One implementation for both, and that is the point.** At one voice this is exactly last-note priority
 * with legato — hold a key, press another, it moves without releasing the gate, and letting the new one go
 * returns to the one still held. At eight voices it is a polyphonic allocator. They came out the same because
 * the rule is the same rule: keep a stack of every key physically held, and sound the newest N of them.
 *
 * That is worth spelling out because the obvious design is two classes, and two classes would have meant the
 * monophonic feel quietly regressing the day polyphony arrived — a mono synth returning to a held note is
 * most of what makes a glide knob mean anything, and an allocator that merely steals a voice does not do it.
 * Written this way, a ninth note on an eight-voice patch steals the oldest and hands it back on release, which
 * is also what a good polysynth does.
 *
 * The assignment is recomputed from the stack rather than mutated in place, and only the voices that actually
 * changed are returned. Declarative is worth more than clever here: every awkward case — a key pressed twice,
 * a note stolen and returned, the count changing mid-chord — falls out of "sound the newest N" without a
 * special case for any of it.
 */
export class Keyboard {
  private voices: number
  private held: { note: number; velocity: number }[] = []
  /** The note each voice is sounding, or null. */
  private sounding: (number | null)[]
  /** The pitch each voice should hold through its release tail — an envelope decaying should not also slide. */
  private resting: number[]
  /** When each voice last fell silent, so the longest-idle one is taken first and a release gets to ring. */
  private freedAt: number[]
  private tick = 0

  constructor(voices = 1) {
    this.voices = Math.max(1, Math.min(8, Math.round(voices)))
    this.sounding = Array.from({ length: this.voices }, () => null)
    this.resting = Array.from({ length: this.voices }, () => 36)
    this.freedAt = Array.from({ length: this.voices }, (_, i) => i)
    this.tick = this.voices
  }

  get count(): number {
    return this.voices
  }

  /** The notes actually sounding right now, for lighting up the keys somebody is playing. */
  playing(): number[] {
    return this.sounding.filter((note): note is number => note !== null)
  }

  /** Change the voice count. Everything stops — a chord half-assigned across a changing number of voices is
   *  not worth the code it would take to preserve, and the patch is being recompiled anyway. */
  setVoices(voices: number): VoiceState[] {
    const next = Math.max(1, Math.min(8, Math.round(voices)))
    const silenced = this.allOff()
    this.voices = next
    this.sounding = Array.from({ length: next }, () => null)
    this.resting = Array.from({ length: next }, () => 36)
    this.freedAt = Array.from({ length: next }, (_, i) => i)
    this.tick = next
    return silenced.filter((state) => state.voice < next)
  }

  down(note: number, velocity: number): VoiceState[] {
    // A repeated note-on for a key already down is a retrigger, not a second entry — some keyboards send them,
    // and a stack that grew would never empty and the gate would never fall.
    this.held = this.held.filter((entry) => entry.note !== note)
    this.held.push({ note, velocity })
    // Forced, because a voice already sounding this note is "unchanged" as far as the assignment is concerned
    // and would emit nothing — so pressing the same key twice would not retrigger the envelope and the new
    // velocity would be dropped. It looks like a dead key.
    return this.reassign(note)
  }

  up(note: number): VoiceState[] {
    const before = this.held.length
    this.held = this.held.filter((entry) => entry.note !== note)
    if (this.held.length === before) return []
    return this.reassign()
  }

  /** Everything off — for a panic, or when the page loses focus mid-note. */
  allOff(): VoiceState[] {
    this.held = []
    return this.reassign()
  }

  /**
   * Work out which voice should sound which note, and report only what changed.
   *
   * The newest `voices` keys sound; anything older is held but silent, waiting to be handed back. A voice
   * already playing a wanted note keeps it, so a chord does not shuffle between voices every time a key
   * moves — which would retrigger envelopes that should be sustaining.
   */
  private reassign(retrigger?: number): VoiceState[] {
    const wanted = this.held.slice(-this.voices)
    const changes: VoiceState[] = []

    const keeping = new Set<number>()
    const placed = new Set<number>()
    for (const entry of wanted) {
      const voice = this.sounding.indexOf(entry.note)
      if (voice !== -1) {
        keeping.add(voice)
        placed.add(entry.note)
        if (entry.note === retrigger) {
          changes.push({ voice, note: entry.note, gate: 1, velocity: entry.velocity })
        }
      }
    }

    // Free voices, longest-idle first, so a note that has just been released keeps ringing while there is
    // somewhere else to put the new one.
    const free = this.sounding
      .map((note, voice) => ({ voice, note }))
      .filter(({ voice, note }) => !keeping.has(voice) && (note === null || !placed.has(note)))
      .sort((a, b) => this.freedAt[a.voice] - this.freedAt[b.voice])
      .map(({ voice }) => voice)

    for (const entry of wanted) {
      if (placed.has(entry.note)) continue
      const voice = free.shift()
      if (voice === undefined) continue
      this.sounding[voice] = entry.note
      this.resting[voice] = entry.note
      placed.add(entry.note)
      changes.push({ voice, note: entry.note, gate: 1, velocity: entry.velocity })
    }

    // Whatever is left over falls silent, at the pitch it was playing.
    for (const voice of free) {
      if (this.sounding[voice] === null) continue
      this.sounding[voice] = null
      this.freedAt[voice] = this.tick++
      changes.push({ voice, note: this.resting[voice], gate: 0, velocity: 0 })
    }

    return changes
  }
}

/**
 * Which MIDI modules in a patch should hear a note on this channel.
 *
 * Pulled out of the event handler and made pure so it can be tested, because Chrome refuses Web MIDI under
 * automation — permission is denied whatever the driver grants — so the handler around this cannot be driven
 * in a browser at all. Extracting the decision leaves one untestable line rather than an untestable rule.
 *
 * Channel 0 on a module means omni. MIDI channels are 1-16 and that is what arrives here, so 0 is free to
 * mean "all of them" without colliding with a real one.
 */
export function midiTargets(
  modules: readonly { id: string; type: string; params?: Record<string, number> }[],
  channel: number,
): string[] {
  return modules
    .filter((module) => {
      if (module.type !== 'midi') return false
      const wanted = module.params?.channel ?? 0
      return wanted === 0 || wanted === channel
    })
    .map((module) => module.id)
}

// ---------------------------------------------------------------------------------------
// The browser half
// ---------------------------------------------------------------------------------------

/**
 * The keyboards, one per MIDI channel.
 *
 * Hoisted out of `openMidi` so the **on-screen keys can share it**. Two allocators would fight: each would
 * believe it owned all the voices, so a note played on screen could be silently stolen by one arriving from
 * hardware, and releasing a key would return a voice the other one thought it still had. One bank means one
 * answer to "what is sounding", which is also what lets the on-screen keys light up for notes that arrived
 * from a controller.
 *
 * One keyboard *per channel*, so two MIDI modules set to different channels split a controller rather than
 * both playing everything.
 */
export class KeyboardBank {
  private voiceCount = 1
  private readonly keyboards = new Map<number, Keyboard>()

  for(channel: number): Keyboard {
    const existing = this.keyboards.get(channel)
    if (existing) return existing
    const fresh = new Keyboard(this.voiceCount)
    this.keyboards.set(channel, fresh)
    return fresh
  }

  get voices(): number {
    return this.voiceCount
  }

  /** Every note sounding on any channel, for lighting a key. */
  sounding(): number[] {
    const notes: number[] = []
    for (const keyboard of this.keyboards.values()) notes.push(...keyboard.playing())
    return notes
  }

  setVoices(voices: number): { state: VoiceState; channel: number }[] {
    this.voiceCount = voices
    const changes: { state: VoiceState; channel: number }[] = []
    for (const [channel, keyboard] of this.keyboards) {
      for (const state of keyboard.setVoices(voices)) changes.push({ state, channel })
    }
    return changes
  }

  allOff(): { state: VoiceState; channel: number }[] {
    const changes: { state: VoiceState; channel: number }[] = []
    for (const [channel, keyboard] of this.keyboards) {
      for (const state of keyboard.allOff()) changes.push({ state, channel })
    }
    return changes
  }
}

export interface MidiEvents {
  onVoice(state: VoiceState, channel: number): void
  onMod(value: number, channel: number): void
  /**
   * Every control change, raw, including the two handled specially below.
   *
   * Raw rather than normalised, because the host has to be able to *learn* the number as well as act on
   * the value — and a 0..1 that has lost which controller sent it cannot be learned. Turning it into the
   * target parameter's units is `cc.ts`'s job, where it is pure and tested; Chrome refuses Web MIDI under
   * automation, so a rule left in here could not be verified at all.
   *
   * CC 1 and CC 123 still do what they did. They are also delivered here, so somebody who wants their mod
   * wheel driving a Combinator rotary can have that too — withholding it would be the handler deciding
   * what the instrument is for.
   */
  onControl(cc: number, value: number, channel: number): void
  /** The currently connected inputs, including hot-plug changes. */
  onInputs?(inputs: string[]): void
}

export interface MidiHandle {
  /** Names of the inputs that were found, for telling somebody whether their keyboard is seen. */
  inputs: string[]
  /** Tell the keyboards how many voices the patch now has. Everything stops, which is what recompiling the
   *  graph does anyway. */
  setVoices(voices: number): void
  close(): void
}

/**
 * Ask for MIDI and start listening.
 *
 * Resolves null when Web MIDI is unavailable or refused. It is Chromium-only, so this is the common case
 * rather than the exceptional one, and absence has to read as absence — the same standard `loadRack` holds
 * itself to when there is no AudioWorklet.
 *
 * Devices connected later are picked up: `statechange` re-subscribes rather than requiring a reload, because
 * plugging the keyboard in after opening the page is what everybody actually does.
 */
export async function openMidi(events: MidiEvents, bank: KeyboardBank): Promise<MidiHandle | null> {
  const request = (
    navigator as Navigator & {
      requestMIDIAccess?: (options?: { sysex: boolean }) => Promise<MIDIAccess>
    }
  ).requestMIDIAccess
  if (!request) return null

  let access: MIDIAccess
  try {
    access = await request.call(navigator, { sysex: false })
  } catch {
    // Refused, or blocked by permissions policy.
    return null
  }

  const onMessage = (event: MIDIMessageEvent) => {
    const data = event.data
    if (!data || data.length < 2) return
    const status = data[0] & 0xf0
    const channel = (data[0] & 0x0f) + 1
    const keyboard = bank.for(channel)
    const emit = (states: VoiceState[]) => {
      for (const state of states) events.onVoice(state, channel)
    }

    if (status === 0x90 && data[2] > 0) {
      emit(keyboard.down(data[1], data[2] / 127))
      return
    }
    // A note-on with velocity zero is a note-off. Older gear sends only that form, and treating it as a
    // note-on leaves the key stuck down forever.
    if (status === 0x80 || (status === 0x90 && data[2] === 0)) {
      emit(keyboard.up(data[1]))
      return
    }
    if (status === 0xb0) {
      // CC 1 is the mod wheel; CC 123 is all-notes-off, which is what a panic button sends.
      if (data[1] === 1) events.onMod(data[2] / 127, channel)
      if (data[1] === 123) emit(keyboard.allOff())
      // And every controller reaches the host, so any of them can be learned onto a parameter. Delivered
      // after the special cases rather than instead of them: the mod wheel keeps working *and* can be
      // bound, which is a decision the message handler should not be making on somebody's behalf.
      events.onControl(data[1], data[2], channel)
    }
  }

  const subscribe = () => {
    const names: string[] = []
    access.inputs.forEach((input) => {
      input.onmidimessage = onMessage
      names.push(input.name ?? 'unnamed')
    })
    return names
  }

  const handle: MidiHandle = {
    inputs: subscribe(),
    setVoices: (voices) => {
      for (const { state, channel } of bank.setVoices(voices)) events.onVoice(state, channel)
    },
    close: () => {},
  }
  events.onInputs?.(handle.inputs)
  access.onstatechange = () => {
    handle.inputs = subscribe()
    events.onInputs?.(handle.inputs)
  }
  handle.close = () => {
    access.inputs.forEach((input) => {
      input.onmidimessage = null
    })
    access.onstatechange = null
  }
  return handle
}
