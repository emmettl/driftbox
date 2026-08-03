import { STEPS_PER_BAR } from '@driftbox/rack'

// Where the rack's transport is, in musical time, as seen from the host.
//
// **The rack had no host-visible playhead at all.** The Graph accumulates a beat position per block on the
// audio thread, and the one that reaches the host belongs to the *groovebox* engine — `hosted.position` —
// which only exists for a compatible patch. A rack-native patch built from modules had nowhere to ask
// "where are we", which is why nothing could record a knob move against a timeline.
//
// **Derived from the context clock rather than reported from the worklet.** The alternative was to grow
// the meter channel, and it is worse for two reasons: that channel is only running while a faceplate is
// listening, so automation would work or not depending on whether a Meter was on screen; and it reports at
// 46Hz, so a point would be recorded up to 22ms from where the knob actually moved. `ctx.currentTime` is
// available always and exactly, and it is *the same clock* `Rack.frameFor` converts against — so a position
// recorded here and a frame scheduled there cannot disagree about when now is.
//
// **Beats are banked on a tempo change rather than recomputed.** This is the one piece of arithmetic worth
// reading twice, and it mirrors what `Graph.setTransport` already does: multiplying total elapsed seconds
// by the current tempo would move every previously recorded position the moment somebody nudged the tempo,
// so a lane recorded at 174 would drift the instant you tried it at 172. Banking what has already elapsed
// and starting a fresh span is what keeps a recorded position meaning what it meant.

export interface Playhead {
  /** Beats banked from spans already finished — every span before the current tempo. */
  banked: number
  /** Context time the current span started at, or null when stopped. */
  since: number | null
  /** Beats per minute for the current span. */
  tempo: number
}

export const STOPPED: Playhead = { banked: 0, since: null, tempo: 120 }

/** Where the transport is, in beats, at a context time. */
export function beatsAt(head: Playhead, now: number): number {
  if (head.since === null) return head.banked
  return head.banked + Math.max(0, now - head.since) * (head.tempo / 60)
}

/** The step — a sixteenth from the top of the arrangement — at a context time. */
export function stepAt(head: Playhead, now: number): number {
  return Math.max(0, Math.floor((beatsAt(head, now) * STEPS_PER_BAR) / 4))
}

/** The context time a step falls at, which is what turns a recorded position back into a frame. */
export function timeOfStep(head: Playhead, step: number): number {
  if (head.since === null) return 0
  const beats = (step * 4) / STEPS_PER_BAR
  return head.since + ((beats - head.banked) * 60) / head.tempo
}

/**
 * Start, stop, or change tempo, banking what has elapsed.
 *
 * Starting from a stop **rewinds to zero**, matching `Graph.setTransport` — a transport that resumed where
 * it left off would put a recording somewhere nobody was looking. Changing tempo while running does not
 * rewind, for the reason at the top of this file.
 */
export function moveTo(
  head: Playhead,
  now: number,
  running: boolean,
  tempo: number,
): Playhead {
  const rate = Number.isFinite(tempo) && tempo > 0 ? Math.max(20, Math.min(400, tempo)) : head.tempo
  if (!running) {
    // Stopping holds the position, so a knob moved while stopped still records where the music is.
    return { banked: beatsAt(head, now), since: null, tempo: rate }
  }
  if (head.since === null) return { banked: 0, since: now, tempo: rate }
  if (rate === head.tempo) return head
  return { banked: beatsAt(head, now), since: now, tempo: rate }
}
