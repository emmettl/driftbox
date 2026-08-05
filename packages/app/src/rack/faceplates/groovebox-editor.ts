import {
  ALL_VOICES,
  DEFAULT_BASS_PARAMS,
  DEFAULT_PARAMS,
  DEFAULT_SENDS,
  chainBarAt,
  songBars,
  swingFor,
  type BassParams,
  type ChainStep,
  type ClipLaunchQuantization,
  type GrooveboxSection,
  type SendLevels,
  type Song,
  type Voice,
  type VoiceParams,
} from '@driftbox/engine'
import type { GrooveboxTapTarget } from '../store.js'
import { sectionName } from './groovebox-format.js'

// What the Groovebox editor is looking at: which sixteen steps, which step inside them, which section of
// the arrangement, and which voice the knobs are wired to.
//
// Out of the component because none of it is React — every function here is a song and some numbers in,
// a decision out. Inside the component they were derivations between the `useState` calls and the JSX,
// which meant the only way to ask whether a 303 cursor wraps correctly at the end of a 12-step pattern was
// to open a browser, retain a song, switch to a 303 and play the pattern past its end.

/** One page of the step grid. Longer patterns page; a 16-step pattern has one page. */
export const PAGE = 16

export interface StepWindow {
  /** How many pages the pattern needs. At least one, even for a zero-length pattern. */
  pages: number
  /** The page actually shown, which is the wanted one clamped into range. */
  shownPage: number
  /** Absolute index of the first step on that page. */
  firstStep: number
  /** The absolute step indices on it — a short final page is short rather than padded. */
  steps: number[]
}

/**
 * The page of steps to draw.
 *
 * `shownPage` is clamped rather than corrected in state, so shortening a pattern while looking at its
 * last page shows the new last page instead of an empty grid, and lengthening it again returns you to
 * where you were.
 */
export function stepWindow(patternLength: number, page: number): StepWindow {
  const pages = Math.max(1, Math.ceil(patternLength / PAGE))
  const shownPage = Math.min(page, pages - 1)
  const firstStep = shownPage * PAGE
  return {
    pages,
    shownPage,
    firstStep,
    steps: Array.from(
      { length: Math.min(PAGE, patternLength - firstStep) },
      (_, index) => firstStep + index,
    ),
  }
}

/**
 * The step the instrument controls are pointed at.
 *
 * The two machines disagree about what selection means, deliberately. A drum lane's selection is a
 * cursor in the grid and clamps at both ends. A 303's is the shared tap-entry position, which the
 * hosted playhead also writes, so it wraps — a playhead running past the end of a short pattern comes
 * back to its first step rather than sticking to its last.
 */
export function focusedStep(
  bass: boolean,
  tapStep: number,
  selectedStep: number,
  patternLength: number,
): number {
  if (!bass) return Math.min(patternLength - 1, Math.max(0, selectedStep))
  return ((Math.floor(tapStep) % patternLength) + patternLength) % patternLength
}

export interface ArrangementView {
  /** The song's chain, or a one-section stand-in for a song that has never been arranged. */
  chain: ChainStep[]
  shownSection: number
  chainStep: ChainStep
  /** The absolute bar that section starts on. */
  sectionStart: number
  /** Bars in the whole song, at least one. */
  totalBars: number
}

/**
 * Which section of the arrangement the clip controls are editing.
 *
 * A song with an empty chain plays its first pattern forever, and the editor has to show that as
 * something — a real section of one bar, rather than a disabled row. Without it the clip and transport
 * controls would be dead on exactly the songs a person is most likely to be starting from.
 */
export function arrangementView(song: Song, wanted: number): ArrangementView {
  const chain =
    song.chain.length > 0 ? song.chain : [{ pattern: song.patterns[0].id, repeat: 1 }]
  const shownSection = Math.min(wanted, chain.length - 1)
  return {
    chain,
    shownSection,
    chainStep: chain[shownSection],
    sectionStart: chainBarAt(song, shownSection),
    totalBars: Math.max(1, songBars(song)),
  }
}

/** Whether the hosted loop is exactly this section, which is what the loop button reports. */
export function sectionLooping(
  loop: { start: number; bars: number } | null | undefined,
  sectionStart: number,
  repeat: number,
): boolean {
  return loop?.start === sectionStart && loop.bars === Math.max(1, repeat)
}

/** How much automation the retained song is carrying, for the line beside the record button. */
export function automationSummary(song: Song): { lanes: number; points: number } {
  return {
    lanes: song.automation?.length ?? 0,
    points: song.automation?.reduce((total, lane) => total + lane.points.length, 0) ?? 0,
  }
}

/** A machine's live clip: what it was launched with, and whether that has taken effect yet. */
export interface Launch {
  patternId: string | null
  phase: 'queued' | 'active'
  quantization: ClipLaunchQuantization
  bar?: number
}

/**
 * What a launched clip is called.
 *
 * A null pattern is the machine following the arrangement rather than a clip, which is a state with no
 * pattern to name. An id with no matching pattern falls back to the id itself: a song can be launched
 * and then edited underneath, and a launch nobody can name is still a launch worth showing.
 */
export function liveClipName(song: Song, live: Launch | undefined): string | undefined {
  if (!live) return undefined
  if (live.patternId === null) return 'song'
  return (
    song.patterns.find((candidate) => candidate.id === live.patternId)?.name ?? live.patternId
  )
}

/** The live region under the launch buttons. Says what is playing, and what is about to. */
export function liveStatus(
  song: Song,
  live: Launch | undefined,
  launchRecording: boolean,
): string {
  if (!live) return 'follows song'
  const name = liveClipName(song, live)
  if (live.phase === 'queued') return `queued ${name} · next ${live.quantization}`
  // The written bar only means anything while the arrangement is being written to.
  return launchRecording && live.bar !== undefined
    ? `active ${name} · written bar ${live.bar + 1}`
    : `active ${name}`
}

export interface Routing {
  /** The kit entry the sends and swing belong to: a drum voice id, or the 303 section itself. */
  voiceId: string | undefined
  name: string
  colour: string
  sends: SendLevels
  /** This voice's swing offset, where 0.5 is "whatever the song says". */
  swingOffset: number
  /** The swing it actually plays with, as a percentage. */
  effectiveSwing: number
}

/**
 * Which kit entry the mix knobs write to, and what colour they are.
 *
 * The 303s are one voice each and route as themselves; a drum machine routes per lane, so the same
 * strip means a different row of the kit depending on which voice is selected. Sending a 909 snare's
 * reverb to the 808's kit entry is silent in the UI and audible nowhere near the knob that caused it.
 */
export function grooveboxRouting(
  song: Song,
  section: GrooveboxSection,
  voice: Voice | undefined,
): Routing {
  const bass = isBassSection(section)
  const voiceId = bass ? section : voice?.id
  return {
    voiceId,
    name: bass ? sectionName(section) : voice?.name ?? sectionName(section),
    colour: bass ? '#ffb02e' : section === 'tr909' ? '#5ff0d0' : '#ff7ad9',
    sends: voiceId ? song.kit.sends?.[voiceId] ?? DEFAULT_SENDS : DEFAULT_SENDS,
    swingOffset: voiceId ? song.kit.swing?.[voiceId] ?? 0.5 : 0.5,
    effectiveSwing: voiceId
      ? Math.round(swingFor(song, voiceId) * 100)
      : Math.round(song.swing * 100),
  }
}

/** Whether a machine is one of the two 303s, which is the line every control in here branches on. */
export function isBassSection(section: GrooveboxSection): boolean {
  return section === '303.a' || section === '303.b'
}

/** The drum lanes of a machine, in kit order. Empty for a 303. */
export function voicesOf(section: GrooveboxSection): Voice[] {
  return ALL_VOICES.filter((voice) => voice.machine === section)
}

/** The drum lane the knobs edit: the wanted one if it still belongs to this machine, else the first. */
export function selectedVoice(voices: Voice[], wanted: string): Voice | undefined {
  return voices.find((candidate) => candidate.id === wanted) ?? voices[0]
}

/** A voice's kit parameters, falling back to the defaults an unedited song leaves unwritten. */
export function drumParamsOf(song: Song, voice: Voice | undefined): VoiceParams {
  return voice ? song.kit.params[voice.id] ?? DEFAULT_PARAMS : DEFAULT_PARAMS
}

/** Likewise for a 303. A drum machine's strip reads the defaults rather than nothing. */
export function bassParamsOf(song: Song, section: GrooveboxSection): BassParams {
  return isBassSection(section)
    ? song.kit.bass?.[section] ?? DEFAULT_BASS_PARAMS
    : DEFAULT_BASS_PARAMS
}

/**
 * Where a keyboard tap lands.
 *
 * A 303 records as the section; a drum machine records into one lane, and picking a machine without
 * naming a lane means its first. Recording taps into whichever lane happened to be selected on the
 * machine you just left is the failure this resolves.
 */
export function tapTarget(
  patternId: string,
  section: GrooveboxSection,
  voiceId?: string,
): GrooveboxTapTarget {
  return {
    patternId,
    section,
    voiceId: isBassSection(section)
      ? section
      : voiceId ?? voicesOf(section)[0]?.id ?? '',
  }
}
