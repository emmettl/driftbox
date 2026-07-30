import { DEFAULT_FX, renderStems, steps, type Song } from '@driftbox/engine'

// Breaks for the sampler — written as patterns and synthesised on load, not shipped as audio.
//
// This is the decision `docs/DNB.md` argues for and it is only available because `engine/stems.ts` already
// renders a song offline into AudioBuffers. Three things fall out of it, all of them the point:
//
//   - **No licence question.** The Amen break is The Winstons' and was never cleared. This repo publishes to
//     npm with signed provenance naming a real person, so shipping famous breaks would be that person's
//     exposure. A break we synthesised is ours.
//   - **The URL survives.** A patch naming `jungle` is a few bytes; two seconds of audio is about 700kB, and
//     putting that in a link would have killed the one thing VCV Rack structurally cannot do.
//   - **It is historically honest.** Jungle layered 909 kicks and hats over breaks constantly. A 909-derived
//     break is not the Amen and is not pretending to be — see the risk noted at the end of `docs/DNB.md`.
//
// The patterns are written in the engine's ASCII notation, which is the whole reason that notation was worth
// reusing: `X` accent, `x` normal, `.` rest. A break is legible as four lines in the source.
//
// **Two bars are rendered and the second one is kept.** That is the trick that makes it loop cleanly: the first
// bar's tails — a snare ring, an open hat — have decayed into the second, so the buffer starts where the last
// hit left off rather than in silence. Trimming to exactly one bar is what makes equal slicing line up with
// sixteenths, and it is why the tempo has to be baked in at render time rather than chosen later.

export interface Break {
  id: string
  name: string
  blurb: string
  /** Beats per minute this was rendered at. Slicing only lines up at this tempo. */
  tempo: number
  /** Sixteenth-note lines per 909 voice. */
  tracks: Record<string, string>
}

/** Sixteen steps is one bar. Every break here is exactly that, so sixteen slices is one slice per sixteenth. */
export const BREAKS: readonly Break[] = [
  {
    id: 'jungle',
    name: 'Jungle',
    blurb: 'Two-step, snare off the grid',
    tempo: 174,
    tracks: {
      // The kick on 1 and the "and" of 3, snare on 2 and 4 with a ghost before it — the two-step that most
      // jungle is a variation on.
      '909.bd': 'X... .... ..X. ....',
      '909.sd': '.... X..x .... X...',
      '909.ch': 'x.x. x.x. x.x. x.xx',
      '909.oh': '..x. .... ..x. ....',
    },
  },
  {
    id: 'amenish',
    name: 'Chopper',
    blurb: 'Busy, syncopated, made to be cut up',
    tempo: 174,
    tracks: {
      // Deliberately dense and off-grid. Chopping rewards a break with something different on every sixteenth,
      // because every slice then sounds like a decision.
      '909.bd': 'X..x ..x. X... ..x.',
      '909.sd': '.... X.x. ..x. X.xx',
      '909.ch': 'x..x x..x x..x x..x',
      '909.rim': '..x. ...x .x.. x...',
    },
  },
  {
    id: 'roller',
    name: 'Roller',
    blurb: 'Straight and relentless, for the bass to sit on',
    tempo: 174,
    tracks: {
      '909.bd': 'X... .... X... ....',
      '909.sd': '.... X... .... X...',
      '909.ch': 'x.xx x.xx x.xx x.xx',
      '909.rd': 'x... x... x... x...',
    },
  },
]

export const breakById = (id: string): Break | undefined => BREAKS.find((entry) => entry.id === id)

/**
 * How many samples one bar is at this tempo.
 *
 * Pulled out and exported because it is the only part of rendering worth testing in Node, and because everything
 * about slicing rests on it: a break trimmed to anything other than exactly one bar puts every slice boundary in
 * the wrong place, and the symptom is a chop that drifts further out of time the further into the bar it gets.
 *
 * Stubbing `OfflineAudioContext` well enough to test the rest was the first attempt and was the wrong shape — the
 * stub grew a method every time the engine's effects chain touched one, and what it proved was that the stub was
 * complete rather than that the render was right. The render is checked in a browser, where a real
 * OfflineAudioContext exists.
 */
export function barSamples(tempo: number, sampleRate: number): number {
  return Math.round((sampleRate * 60 * 4) / tempo)
}

export interface RenderOptions {
  sampleRate?: number
  offline?: (channels: number, length: number, rate: number) => OfflineAudioContext
}

/**
 * Render a break to a mono buffer, exactly one bar long.
 *
 * Mono because the rack's cables are, and summing here rather than in the sampler means the sampler never has to
 * have an opinion about channel counts.
 */
export async function renderBreak(
  entry: Break,
  options: RenderOptions = {},
): Promise<Float32Array> {
  const sampleRate = options.sampleRate ?? 44100
  const song = songFor(entry)

  const stems = await renderStems(song, {
    sampleRate,
    // Enough for an open hat to ring out past the end of bar two; the tail is discarded with everything after
    // the second bar anyway.
    tail: 1,
    offline: options.offline,
  })

  const perBar = barSamples(entry.tempo, sampleRate)
  const out = new Float32Array(perBar)

  for (const stem of stems) {
    const channels = stem.buffer.numberOfChannels
    for (let channel = 0; channel < channels; channel++) {
      const source = stem.buffer.getChannelData(channel)
      for (let i = 0; i < perBar; i++) {
        // The SECOND bar. The first bar's tails have decayed into it, so the loop starts where the last hit left
        // off rather than in silence — which is what stops a rendered break clicking every time it wraps.
        const at = perBar + i
        if (at < source.length) out[i] += source[at] / channels
      }
    }
  }

  // Normalise to just under full scale. The stems are already trimmed against each other by the engine, but the
  // sum of four voices lands wherever it lands, and a break that arrives at a predictable level is one whose
  // channel fader means the same thing from one break to the next.
  let peak = 0
  for (const x of out) peak = Math.max(peak, Math.abs(x))
  if (peak > 0) {
    const gain = 0.9 / peak
    for (let i = 0; i < out.length; i++) out[i] *= gain
  }
  return out
}

/** A two-bar Song of nothing but this break, at its own tempo. */
function songFor(entry: Break): Song {
  const tracks: Record<string, ReturnType<typeof steps>> = {}
  for (const [voiceId, line] of Object.entries(entry.tracks)) tracks[voiceId] = steps(line)

  return {
    bpm: entry.tempo,
    swing: 0,
    patterns: [{ id: 'break', name: entry.name, length: 16, tracks, bass: {} }],
    // Twice, so the second bar can be the one that is kept.
    chain: [{ pattern: 'break', repeat: 2 }],
    kit: { params: {}, bass: {}, sends: {}, swing: {} },
    fx: DEFAULT_FX,
  }
}
