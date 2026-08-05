import {
  bassStepSounds,
  delayDivision,
  pcfDecaySeconds,
  pcfFrequency,
  type BassStep,
  type GrooveboxSection,
  type StepValue,
} from '@driftbox/engine'

// Every string the Groovebox editor puts on screen, and nothing else.
//
// Out of the component because a label is the only part of a step grid a blind test can read. These were
// nested ternaries inside JSX attributes — the kind of expression that is never wrong loudly. A 303 step
// that retains its pitch while paused and still announces itself as a note reads as correct in a
// screenshot and is wrong to anybody listening to a screen reader.

/** 808, 909, 303 A, 303 B — the names on the machines rather than the ids in the song. */
export const sectionName = (section: GrooveboxSection): string =>
  section === 'tr808'
    ? '808'
    : section === 'tr909'
      ? '909'
      : section === '303.a'
        ? '303 A'
        : '303 B'

/** A drum or PCF step, as the three states the grid draws and announces. */
export const stepState = (value: number): 'accent' | 'hit' | 'rest' =>
  value === 2 ? 'accent' : value === 1 ? 'hit' : 'rest'

/** The same three states of a PCF step, said the way the filter means them. */
export const pcfStateLabel = (value: StepValue): string =>
  value === 0 ? 'off' : value === 1 ? 'on' : 'accent'

/**
 * A 303 step's state, which is not `stepState`.
 *
 * A paused step keeps its pitch and its accent flag so the note survives being switched off and on
 * again, so accent alone does not make it a hit. Whether it sounds decides first.
 */
export const bassStepState = (step: BassStep): 'accent' | 'hit' | 'rest' =>
  !bassStepSounds(step) ? 'rest' : step.accent ? 'accent' : 'hit'

/** What a 303 step announces: whether it sounds, its pitch, and the two flags that shape it. */
export const bassStepLabel = (step: BassStep): string =>
  step.note === null
    ? 'rest'
    : `${bassStepSounds(step) ? 'note' : 'paused pitch'} ${step.note}${
        step.accent ? ', accent' : ''
      }${step.slide ? ', slide' : ''}`

/** The pitch in the selected-step readout. A leading dot marks a pitch that is being held silent. */
export const bassNoteReadout = (step: BassStep): string =>
  step.note === null ? '—' : `${bassStepSounds(step) ? '' : '·'}${step.note}`

export const percent = (value: number): string => `${Math.round(value * 100)}`

export const pan = (value: number): string => {
  const amount = Math.round((value - 0.5) * 200)
  return amount === 0 ? 'C' : amount < 0 ? `L${-amount}` : `R${amount}`
}

export const wave = (value: number): string => (value < 0.5 ? 'saw' : 'sqr')

/**
 * What the tap button promises, which is a different promise on each machine.
 *
 * A 303 records against a cursor you can see when the transport is stopped and against the hosted
 * playhead when it is not. A drum machine only records against the playhead, so arming it while stopped
 * has to say that nothing will happen yet rather than looking armed and swallowing the taps.
 */
export function tapArmTitle(state: {
  armed: boolean
  bass: boolean
  running: boolean
  target: string
  /** The 303 entry cursor, zero based. */
  step: number
}): string {
  if (!state.armed) return `Quantise rack keyboard taps into the focused ${state.target} clip`
  if (state.bass) {
    return `303 entry armed — stopped: cursor step ${state.step + 1}; playing: hosted playhead`
  }
  return state.running
    ? `Recording keyboard taps into ${state.target} at the hosted playhead`
    : 'Tap recording armed — start playback, then play the rack keyboard'
}

/** The same distinction for the automation recorder: armed is not the same as recording. */
export function automationArmTitle(armed: boolean, running: boolean): string {
  if (!armed) return 'Record tempo, swing and instrument controls into the retained song'
  return running
    ? 'Recording supported controls at the hosted song playhead'
    : 'Automation armed — start playback, then move a supported control'
}

/** The live region beside it: what it is doing now, or how much it has already collected. */
export function automationStatus(
  armed: boolean,
  running: boolean,
  lanes: number,
  points: number,
): string {
  const state = armed ? (running ? 'recording' : 'armed') : `${lanes} lanes`
  return points > 0 ? `${state} · ${points} points` : state
}

/** The shared-effect knob readouts, which are the only ones that carry a unit. */
export const fxFormat = {
  drive: (value: number) => (value === 0 ? 'clean' : percent(value)),
  pcfAmount: (value: number) => (value === 0 ? 'off' : percent(value)),
  pcfCutoff: (value: number) => `${Math.round(pcfFrequency(value))}Hz`,
  pcfDecay: (value: number) => `${Math.round(pcfDecaySeconds(value) * 1000)}ms`,
  compressor: (value: number) => (value === 0 ? 'off' : percent(value)),
  delayTime: (value: number) => `${delayDivision(value)}/16`,
  reverbSize: (value: number) => `${(0.3 + value * 3.5).toFixed(1)}s`,
} as const
