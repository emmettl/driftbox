import type { VoiceSpec } from './types.js'

// The click.
//
// Described as a VoiceSpec like everything else, so it goes through the same renderer as
// the drums and needs no special path — but it is emphatically NOT a voice. It has no
// knobs, it is not in the kit, it never appears in a pattern, and it does not go through
// the bus. See `index.ts` for the routing, which is the part that matters.

/**
 * A short wooden tick. Two partials rather than one, because a single sine reads as a
 * test tone and gets lost under a kick; the pair beats against each other just enough to
 * cut through without being a sound anybody has to enjoy.
 *
 * `strong` marks the first beat of the bar — higher and a touch louder, which is what
 * makes a count-in tell you where the bar is rather than just how fast it is going.
 */
export function metronomeClick(strong: boolean): VoiceSpec {
  const base = strong ? 1600 : 1050
  const decay = 0.035

  const partial = (frequency: number, gain: number) =>
    ({
      kind: 'osc' as const,
      type: 'square' as const,
      frequency,
      gain,
      amp: [
        { to: 1, at: 0.0008, curve: 'lin' as const },
        { to: 0, at: decay },
      ],
    })

  return {
    duration: decay + 0.02,
    // Measured, not chosen, and twice over.
    //
    // At 0.5/0.34 the strong click rendered at a peak of 1.01 — over full scale, which
    // matters more here than anywhere else in the engine because the click goes straight
    // to the output, past the bus compressor that catches everything else.
    //
    // Correcting that alone left strong at 0.68 and weak at 0.67, near enough identical:
    // the downbeat stopped being audibly a downbeat, because the two clicks are at
    // different frequencies and the same gain does not produce the same peak. The pair
    // below is set from the rendered peaks rather than from the gains — strong 0.70,
    // weak 0.50 — so the bar is obvious without the click ever clipping.
    gain: strong ? 0.376 : 0.25,
    sources: [
      partial(base, 0.6),
      partial(base * 1.47, 0.4),
      // A scrape of high noise on the transient. Without it the click is pitched enough
      // to sound like part of the music, which is the one thing a metronome must not do.
      {
        kind: 'noise',
        gain: 0.35,
        amp: [
          { to: 1, at: 0.0004, curve: 'lin' },
          { to: 0, at: 0.008 },
        ],
        filter: { type: 'highpass', frequency: 4000 },
      },
    ],
    filter: { type: 'bandpass', frequency: base, Q: 1.1 },
  }
}
