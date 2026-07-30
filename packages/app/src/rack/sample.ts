// Loading somebody's own break into the Sampler.
//
// `docs/DNB.md` argued for this from the start — *"a sampler that can only play what we shipped is a toy"* —
// and it is now the path rather than a nicety: the synthesised breaks were listened to and judged not to
// carry the genre. The shipped ones stay, because they need no licence and they survive URL sharing, but a
// real break has to be loadable.
//
// This file is the arithmetic, kept away from the decoding and the DOM so it can be tested. There are only
// two interesting questions and they are both about time.
//
// **How long is a bar of this file?** The Sampler slices by equal division, so a chop only lands on the beat
// if the buffer is a whole number of bars and the patch runs at the tempo that makes it so. Rather than ask
// somebody to type a tempo, the tempo is *derived* from the file: state how many bars it is and the rest
// follows exactly. That is the same trick `breaks.ts` uses in reverse, and it is why chopping works there.
//
// **How many bars is it?** Guessed, then shown. A one-bar loop at 174bpm and a two-bar loop at 174bpm differ
// by a factor of two, and picking the count whose implied tempo sits closest to what the patch is already
// running at gets it right nearly always — because somebody dropping a break into a 174bpm patch has a
// 174bpm break. When it is wrong it is wrong by an octave of tempo, which is instantly obvious and one click
// to fix.

/** The tempo at which `duration` seconds is exactly `bars` bars. */
export function tempoForBars(duration: number, bars: number, beatsPerBar = 4): number {
  if (!(duration > 0) || !(bars > 0)) return 0
  return (bars * beatsPerBar * 60) / duration
}

/** Bar counts worth considering. Powers of two, because loops are. */
const CANDIDATES = [1, 2, 4, 8]

/**
 * How many bars a file most likely is, given what the patch is already playing at.
 *
 * Returns the candidate whose implied tempo is closest to `near` **in ratio, not in difference** — tempo is
 * heard as a ratio, so 87 is exactly as far from 174 as 348 is, and a linear comparison would always prefer
 * the slower guess.
 */
export function guessBars(duration: number, near: number, beatsPerBar = 4): number {
  if (!(duration > 0)) return 1
  let best = CANDIDATES[0]
  let bestError = Infinity
  for (const bars of CANDIDATES) {
    const tempo = tempoForBars(duration, bars, beatsPerBar)
    if (!(tempo > 0)) continue
    const error = Math.abs(Math.log2(tempo / near))
    if (error < bestError) {
      bestError = error
      best = bars
    }
  }
  return best
}

/**
 * Sum an AudioBuffer down to one channel.
 *
 * The rack's cables are mono and staying that way, so this happens here rather than in the Sampler — which
 * then never has to have an opinion about channel counts. Averaged rather than added: two channels summed
 * at full level is 6dB of gain that nobody asked for.
 */
export function toMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels
  const out = new Float32Array(buffer.length)
  if (channels === 0) return out
  for (let channel = 0; channel < channels; channel++) {
    const source = buffer.getChannelData(channel)
    for (let i = 0; i < out.length; i++) out[i] += source[i] / channels
  }
  return out
}

/**
 * Scale a buffer so its loudest sample sits just under full scale.
 *
 * The same 0.9 the rendered breaks use, and for the same reason: a break that arrives at a predictable level
 * is one whose channel fader means the same thing from one break to the next. Somebody's own file could be
 * mastered anywhere, so this matters more here than it did there.
 */
export function normalise(samples: Float32Array, peak = 0.9): Float32Array {
  let loudest = 0
  for (const x of samples) {
    const magnitude = x < 0 ? -x : x
    if (magnitude > loudest) loudest = magnitude
  }
  if (loudest === 0) return samples
  const gain = peak / loudest
  for (let i = 0; i < samples.length; i++) samples[i] *= gain
  return samples
}

/** A file's name without its extension, for naming the patch after what was loaded. */
export function sampleName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').slice(0, 60) || 'sample'
}
