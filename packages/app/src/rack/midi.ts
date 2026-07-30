// Web MIDI, and the note-priority rule that turns a keyboard into one voice.
//
// Two halves, deliberately split. `MonoVoice` is the rule and knows nothing about the browser, so it is
// tested here as plain arithmetic on note numbers. `openMidi` is the plumbing, which is untestable in Node
// and is correspondingly thin — it asks for access, subscribes, and forwards bytes.
//
// The rack's audio thread cannot do any of this itself: an `AudioWorkletGlobalScope` has no `navigator`. See
// the comment at the top of `@driftbox/rack`'s `modules/midi.ts` for why that needed no new message anyway.

/** What the MIDI module's hidden params should be set to. */
export interface Voice {
  note: number
  gate: 0 | 1
  velocity: number
}

/**
 * One voice from a keyboard, with **last-note priority** and legato.
 *
 * Holding one key and pressing another moves to the new note without releasing the gate; letting the new one
 * go returns to the one still held. That is what makes a glide knob mean anything, and it is the same
 * behaviour the engine's 303 keyboard has for the same reason — the roadmap over there calls it "the
 * sequencer's slide reached from the other end".
 *
 * A stack rather than a single value, because the alternative — gate falls whenever any key is released —
 * makes a legato passage stutter, and it is the thing that reads as a bug to anybody who plays.
 */
export class MonoVoice {
  private held: { note: number; velocity: number }[] = []

  /** Returns the voice to send, or null when nothing about it changed. */
  down(note: number, velocity: number): Voice | null {
    // A repeated note-on for a key already down is a retrigger, not a second entry — some keyboards send
    // them, and a stack that grew would never empty and the gate would never fall.
    this.held = this.held.filter((entry) => entry.note !== note)
    this.held.push({ note, velocity })
    return this.current()
  }

  up(note: number): Voice | null {
    const before = this.held.length
    this.held = this.held.filter((entry) => entry.note !== note)
    if (this.held.length === before) return null
    return this.current()
  }

  /** Everything off — for a panic, or when the page loses focus mid-note. */
  allOff(): Voice {
    this.held = []
    return { note: this.last, gate: 0, velocity: 0 }
  }

  private last = 36

  private current(): Voice {
    const top = this.held[this.held.length - 1]
    if (!top) return { note: this.last, gate: 0, velocity: 0 }
    // The note is remembered through the release, so the gate falling does not also drag the pitch somewhere
    // — an envelope's release tail should decay at the pitch it was played at.
    this.last = top.note
    return { note: top.note, gate: 1, velocity: top.velocity }
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

export interface MidiEvents {
  onVoice(voice: Voice, channel: number): void
  onMod(value: number, channel: number): void
}

export interface MidiHandle {
  /** Names of the inputs that were found, for telling somebody whether their keyboard is seen. */
  inputs: string[]
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
export async function openMidi(events: MidiEvents): Promise<MidiHandle | null> {
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

  const voices = new Map<number, MonoVoice>()
  const voiceFor = (channel: number) => {
    const existing = voices.get(channel)
    if (existing) return existing
    // One voice per channel, so two MIDI modules set to different channels split a keyboard rather than
    // both playing everything.
    const fresh = new MonoVoice()
    voices.set(channel, fresh)
    return fresh
  }

  const onMessage = (event: MIDIMessageEvent) => {
    const data = event.data
    if (!data || data.length < 2) return
    const status = data[0] & 0xf0
    const channel = (data[0] & 0x0f) + 1
    const voice = voiceFor(channel)

    if (status === 0x90 && data[2] > 0) {
      const next = voice.down(data[1], data[2] / 127)
      if (next) events.onVoice(next, channel)
      return
    }
    // A note-on with velocity zero is a note-off. Older gear sends only that form, and treating it as a
    // note-on leaves the key stuck down forever.
    if (status === 0x80 || (status === 0x90 && data[2] === 0)) {
      const next = voice.up(data[1])
      if (next) events.onVoice(next, channel)
      return
    }
    if (status === 0xb0) {
      // CC 1 is the mod wheel; CC 123 is all-notes-off, which is what a panic button sends.
      if (data[1] === 1) events.onMod(data[2] / 127, channel)
      if (data[1] === 123) events.onVoice(voice.allOff(), channel)
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

  const handle: MidiHandle = { inputs: subscribe(), close: () => {} }
  access.onstatechange = () => {
    handle.inputs = subscribe()
  }
  handle.close = () => {
    access.inputs.forEach((input) => {
      input.onmidimessage = null
    })
    access.onstatechange = null
  }
  return handle
}
