// Following somebody else's clock.
//
// MIDI clock is twenty-four ticks to the quarter note and carries no tempo in it: the tempo *is*
// how fast the ticks arrive. So a receiver has to measure it, and the measurement is the whole
// problem — the obvious `60000 / (24 * (now - last))` produces a tempo that wobbles several beats
// per minute and is unusable for anything.
//
// **The wobble is not the sender's fault, it is where the timestamps come from.** Web MIDI
// delivers on the main thread, so a tick's arrival is a message queued behind whatever else that
// thread was doing — a render, a layout, a garbage collection. At 120bpm a tick is 20.8ms apart,
// and two milliseconds of scheduling jitter on a single interval is a ten percent tempo error.
// Divide one noisy interval and you get noise back.
//
// So this fits a line instead. Twenty-four ticks arrive over half a second, and a least-squares
// slope through all of them averages the jitter down while measuring across a lever arm two orders
// of magnitude longer than one interval: the same two milliseconds of noise over 48 ticks is an
// error of about a tenth of a beat per minute rather than twelve.
//
// It is deliberately all arithmetic on numbers. There is no `navigator`, no MIDI access and no
// audio in this file, because the hard part is the estimator and the estimator is exactly the part
// a test can feed a stream of deliberately awful timestamps to. The plumbing that turns bytes into
// calls is thin, lives in the app, and is correspondingly hard to get wrong.

/** MIDI clock is twenty-four ticks to the quarter note. Fixed by the spec, not a preference. */
export const TICKS_PER_QUARTER = 24

/** Six ticks to a sixteenth, which is what a step is here. */
export const TICKS_PER_STEP = TICKS_PER_QUARTER / 4

/**
 * How many ticks the slope is fitted over — two beats.
 *
 * The trade is entirely between noise and responsiveness. A longer window rejects more jitter and
 * takes longer to notice a real tempo change; at two beats a hand-turned tempo knob on a hardware
 * sequencer is followed within about a second, which is faster than anybody turns one, and the
 * residual noise is well under the half a beat per minute anybody could hear.
 */
const WINDOW = 48

/**
 * Before this many ticks the tempo is not reported at all.
 *
 * Half a beat. Reporting from two ticks would mean the first thing a host does on pressing play
 * elsewhere is jump to a tempo drawn from a single jittery interval, which is audible as a lurch
 * and then a settle. Waiting a twelfth of a second and starting correct is better.
 */
const MINIMUM = 12

/** Outside this, it is not a tempo — it is a stall, a burst, or a corrupted stream. */
const MIN_BPM = 20
const MAX_BPM = 300

/**
 * No tick for this long and the clock is considered gone.
 *
 * Senders do not always send stop. Pulling a cable, closing a DAW or putting a laptop to sleep all
 * end the stream with no message at all, and a follower that kept its last tempo for ever would
 * leave the host waiting on a clock that is never coming back. Half a second is more than twenty
 * ticks at any tempo this accepts.
 */
const STALL_MS = 500

/**
 * How far past one interval a tick must land before it is read as a dropped tick rather than a
 * late one. See the reasoning where it is used — 1.5 is the arithmetically obvious value and the
 * wrong one, because being wrong in this direction is much more expensive than being wrong in the
 * other.
 */
const DROP_THRESHOLD = 1.75

interface Line {
  slope: number
  intercept: number
}

interface Sample {
  index: number
  time: number
}

/** Ordinary least squares of arrival time against tick index. Six lines, written out rather than
 *  reached for, because this package has no dependencies and this is all of the statistics. */
function regress(samples: readonly Sample[]): Line | null {
  let meanIndex = 0
  let meanTime = 0
  for (const sample of samples) {
    meanIndex += sample.index
    meanTime += sample.time
  }
  meanIndex /= samples.length
  meanTime /= samples.length

  let covariance = 0
  let variance = 0
  for (const sample of samples) {
    const di = sample.index - meanIndex
    covariance += di * (sample.time - meanTime)
    variance += di * di
  }
  // Every sample at the same index, which no real stream produces but which would divide by zero.
  if (variance === 0) return null

  const slope = covariance / variance
  return { slope, intercept: meanTime - slope * meanIndex }
}

/** How far a sample sits from the line, in milliseconds. */
function residual(sample: Sample, line: Line): number {
  return sample.time - (line.intercept + line.slope * sample.index)
}

/** What arrived. `null` for every byte that is not one of these — most of the stream. */
export type ClockMessage = 'tick' | 'start' | 'stop' | 'continue' | 'position'

export interface ParsedClock {
  message: ClockMessage
  /** Only for `position`: where the sender says the song is, in sixteenth notes from the top. */
  step?: number
}

/**
 * Read a system message, if this is one.
 *
 * **System real-time messages are a single byte**, which is the detail that keeps this from
 * working when somebody adds it to an existing handler. Note, control and pitch messages are all
 * two or three bytes, so a dispatcher that begins by rejecting anything shorter — as this app's
 * did — discards every clock tick before looking at it, and the symptom is a follower that never
 * receives anything while the MIDI input is demonstrably working.
 *
 * Song Position Pointer is the exception at three bytes: two seven-bit halves, little end first,
 * counting *MIDI beats*, which are sixteenth notes rather than quarters. A DAW sends it when you
 * move the playhead, so it is what makes starting from the middle of a song land in the right
 * place rather than at the top.
 */
export function parseClock(data: ArrayLike<number>): ParsedClock | null {
  if (data.length < 1) return null
  switch (data[0]) {
    case 0xf8:
      return { message: 'tick' }
    case 0xfa:
      return { message: 'start' }
    case 0xfb:
      return { message: 'continue' }
    case 0xfc:
      return { message: 'stop' }
    case 0xf2:
      if (data.length < 3) return null
      return { message: 'position', step: (data[1] & 0x7f) | ((data[2] & 0x7f) << 7) }
    default:
      return null
  }
}

/** What the follower currently believes. */
export interface ClockState {
  /** The estimate, or null before it has seen enough ticks to have one. */
  bpm: number | null
  /** Whether the sender has told us it is playing. Tempo is tracked either way — plenty of gear
   *  sends clock continuously and only starts the transport when you press play. */
  running: boolean
  /** Ticks since the last start or continue. Position, for anything that wants to align to it. */
  ticks: number
}

/**
 * Tempo and transport, followed from a stream of clock messages.
 *
 * Every method takes the timestamp rather than reading a clock, so a test can hand it a stream
 * that jitters, stalls and drops ticks, and so the caller can pass `MIDIMessageEvent.timeStamp` —
 * which is when the message actually arrived rather than when the handler got round to it, and is
 * therefore already better than anything this could measure for itself.
 */
export class ClockFollower {
  /** Tick index against arrival time, most recent last. Indices are not consecutive when ticks
   *  have been dropped — that is the point of storing them rather than counting. */
  private readonly samples: Sample[] = []
  private nextIndex = 0
  private lastTime: number | null = null
  private tempo: number | null = null
  /** The current fit, kept so the next arrival can be placed against it rather than against the
   *  previous arrival. Null until there are enough samples. */
  private line: Line | null = null
  private playing = false
  private position = 0

  get state(): ClockState {
    return { bpm: this.tempo, running: this.playing, ticks: this.position }
  }

  /** Where the sender is, in sixteenth notes, if it has said. */
  get step(): number {
    return Math.floor(this.position / TICKS_PER_STEP)
  }

  /**
   * One tick arrived. Returns the state after it, so a caller can act on the change without
   * asking a second question.
   */
  tick(time: number): ClockState {
    // A gap far longer than the stream's own spacing is not a slow tick, it is a new stream: the
    // sender stopped without saying so, or the tab was in the background and the queue drained in
    // a burst afterwards. Either way the old samples describe a different situation.
    if (this.lastTime !== null && time - this.lastTime > STALL_MS) this.reset()

    // Dropped ticks are inferred rather than ignored: treating a double-length gap as one tick
    // would report a stream at half speed. The inference is made against the *fitted line* rather
    // than against the previous arrival, and that is not a refinement — it is the difference
    // between working and not.
    //
    // Dividing the gap by the expected interval asks a jittered timestamp to adjudicate on another
    // jittered timestamp. At two milliseconds of noise it is fine; at ten, which is a garbage
    // collection, consecutive arrivals can be twenty milliseconds apart in either direction and a
    // gap of nearly two intervals happens with no tick missing at all. Every spurious drop then
    // shifts the index sequence and corrupts the slope, which measured as a sixteen beat per
    // minute error where the raw noise was worth two.
    //
    // The line is fitted across the whole window, so its estimate of where a tick falls carries a
    // fraction of that noise. Rounding to the nearest index against it is asking the same question
    // of a much steadier witness.
    // And the decision is biased towards "late" rather than "dropped", which is the second thing
    // that has to be right. Rounding to nearest treats a tick three quarters of an interval late —
    // a garbage collection, once in a while, entirely normal — as a tick that never came. That
    // costs far more than being wrong about one sample: every index after it is shifted by one, so
    // the window holds a step discontinuity and the slope is fitted through a stream that appears
    // to change speed. Measured on one fifteen-millisecond stall in twenty ticks, rounding to
    // nearest gave a six beat per minute error from a stream whose baseline noise was worth a
    // twentieth of that.
    //
    // Drops are rare and lateness is constant, so the threshold sits well above the halfway point.
    // A genuine drop lands near 2.0 and is still caught; a tick that is merely very late stays
    // where it belongs.
    let advance = 1
    if (this.line) {
      const predicted = (time - this.line.intercept) / this.line.slope
      const raw = predicted - (this.nextIndex - 1)
      if (raw >= DROP_THRESHOLD) advance = Math.max(1, Math.min(8, Math.round(raw)))
    }

    this.nextIndex += advance - 1
    this.samples.push({ index: this.nextIndex, time })
    this.nextIndex += 1
    this.lastTime = time
    if (this.samples.length > WINDOW) this.samples.shift()
    if (this.playing) this.position += advance

    this.tempo = this.fit()
    return this.state
  }

  /** The sender pressed play. Position returns to the top. */
  start(): ClockState {
    this.reset()
    this.playing = true
    this.position = 0
    return this.state
  }

  /** The sender pressed play without rewinding. Tempo is re-measured; position is kept. */
  continue_(): ClockState {
    this.reset()
    this.playing = true
    return this.state
  }

  stop(): ClockState {
    this.playing = false
    return this.state
  }

  /** The sender moved its playhead. `step` is in sixteenth notes from the top of the song. */
  locate(step: number): ClockState {
    this.position = Math.max(0, Math.floor(step)) * TICKS_PER_STEP
    return this.state
  }

  /**
   * Whether the clock has gone quiet.
   *
   * Asked by the host on a timer rather than pushed, because the event that matters here is the
   * absence of an event and nothing arrives to report it.
   */
  lost(now: number): boolean {
    return this.lastTime !== null && now - this.lastTime > STALL_MS
  }

  /** Forget the measurement, keep the transport. Used whenever the stream becomes discontinuous:
   *  a fit across a gap describes a tempo that was never played. */
  private reset(): void {
    this.samples.length = 0
    this.nextIndex = 0
    this.lastTime = null
    this.tempo = null
    this.line = null
  }

  /**
   * The least-squares slope through the window, as a tempo.
   *
   * Ordinary linear regression of arrival time against tick index. The slope is milliseconds per
   * tick; everything else is unit conversion. It is written out rather than reached for from a
   * library because it is six lines and this package has no dependencies.
   */
  private fit(): number | null {
    if (this.samples.length < MINIMUM) return null

    const first = regress(this.samples)
    if (!first) return null

    // **A second pass, with the worst samples left out, and it is not a polish.**
    //
    // Least squares gives a single distant sample enormous leverage when it sits near the end of
    // the window — the influence of a point grows with its distance from the middle. One tick
    // stalled by fifteen milliseconds at the edge of a seventeen-sample window pulled the estimate
    // from 120 to 121.7 on its own.
    //
    // That alone would be tolerable. What made it serious is that the biased slope then made the
    // *next* stalled tick look like a dropped one, which inserted an index that was never sent,
    // which biased the slope further. Measured, that runaway settled at 126.2bpm on a 120bpm
    // stream — a five percent error out of a stream whose baseline noise was worth a twentieth of
    // that, and it grew rather than averaging out.
    //
    // Three mean absolute residuals is a wide net: ordinary jitter sits well inside it and only a
    // genuine stall is excluded. Refitting without those is enough to stop the feedback at the
    // source, rather than raising the drop threshold until this particular stream stops tripping it.
    let total = 0
    for (const sample of this.samples) total += Math.abs(residual(sample, first))
    const limit = (total / this.samples.length) * 3

    const kept = this.samples.filter((sample) => Math.abs(residual(sample, first)) <= limit)
    const second = kept.length >= MINIMUM ? regress(kept) : null
    const line = second ?? first

    const msPerTick = line.slope
    if (!(msPerTick > 0)) return null
    this.line = line

    const bpm = 60_000 / (msPerTick * TICKS_PER_QUARTER)
    // Clamped rather than rejected. A tempo outside this is a broken stream, and the last good
    // estimate is a better thing to keep playing at than a number nobody chose.
    if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) return this.tempo
    return bpm
  }
}
