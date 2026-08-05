import {
  alterBassLine,
  alterTrack,
  clearBassLine,
  clearTrack,
  copyBassLine,
  copyDrumLane,
  pasteBassLine,
  pasteDrumLane,
  randomizeBassLine,
  randomizeTrack,
  rotateBassLine,
  rotateTrack,
  type BassLineClipboard,
  type DrumLaneClipboard,
  type GrooveboxSection,
  type Pattern,
  type Voice,
} from '@driftbox/engine'
import { isBassSection, selectedVoice, voicesOf } from './groovebox-editor.js'
import { sectionName } from './groovebox-format.js'

// What "the focus" is, and every edit that applies to it.
//
// One toggle in the tool row decides whether an edit means one drum lane or all of a machine's lanes at
// once, and six controls read it — rotate, cut, copy, paste, and the two labels that promise which of
// those two things is about to happen. Getting that promise wrong is the worst kind of bug this editor
// can have: a button that says "lane" and clears eleven of them, with nothing on screen to suggest it
// did. Out of the component so the promise and the edit can be checked against each other.
//
// Randomise and alter deliberately do not follow the toggle. They replace or rearrange material, and
// doing that to a whole machine behind a toggle set for a rotation is not something a confirmation
// dialog makes safe.

export interface Focus {
  bass: boolean
  section: GrooveboxSection
  /** Every drum lane of the machine, in kit order. Empty for a 303. */
  voices: Voice[]
  /** The one lane the knobs and the single-lane edits are pointed at. */
  voice: Voice | undefined
  /** Whether the tool row's toggle is set to the whole machine rather than the one lane. */
  wholeMachine: boolean
  /** The lanes a rotation or a clipboard edit applies to: one, or the whole machine. */
  lanes: Voice[]
}

/** Resolve the machine, the wanted lane and the whole-machine toggle into one thing to act on. */
export function grooveboxFocus(
  section: GrooveboxSection,
  wantedVoice: string,
  wholeMachine: boolean,
): Focus {
  const bass = isBassSection(section)
  const voices = voicesOf(section)
  const voice = selectedVoice(voices, wantedVoice)
  return {
    bass,
    section,
    voices,
    voice,
    wholeMachine,
    lanes: wholeMachine ? voices : voice ? [voice] : [],
  }
}

/** What the single-lane controls name: the selected drum lane, or the 303. */
export function focusedName(focus: Focus): string {
  return focus.bass ? sectionName(focus.section) : focus.voice?.name ?? sectionName(focus.section)
}

/** What the toggle-following controls name. The word "whole" is the only warning there is. */
export function focusLabel(focus: Focus): string {
  return !focus.bass && focus.wholeMachine
    ? `whole ${sectionName(focus.section)}`
    : focusedName(focus)
}

/** Shift the focused material around the pattern, keeping its length. */
export function rotateFocus(pattern: Pattern, focus: Focus, delta: number): Pattern {
  if (focus.bass) return rotateBassLine(pattern, focus.section, delta)
  let next = pattern
  for (const lane of focus.lanes) next = rotateTrack(next, lane.id, delta)
  return next
}

/** Replace the selected lane's material. One lane, never the machine — see the note above. */
export function randomizeFocus(pattern: Pattern, focus: Focus): Pattern {
  if (focus.bass) return randomizeBassLine(pattern, focus.section)
  return focus.voice ? randomizeTrack(pattern, focus.voice.id) : pattern
}

/** Rearrange the selected lane's existing material. One lane, for the same reason. */
export function alterFocus(pattern: Pattern, focus: Focus): Pattern {
  if (focus.bass) return alterBassLine(pattern, focus.section)
  return focus.voice ? alterTrack(pattern, focus.voice.id) : pattern
}

export type FocusClipboard =
  | {
      kind: 'drum'
      label: string
      section: GrooveboxSection
      lanes: DrumLaneClipboard[]
    }
  | { kind: 'bass'; label: string; line: BassLineClipboard }

/** Take a copy of the focused material, or nothing when the focus holds no lanes to copy. */
export function copyFocus(pattern: Pattern, focus: Focus): FocusClipboard | null {
  if (focus.bass) {
    return {
      kind: 'bass',
      label: sectionName(focus.section),
      line: copyBassLine(pattern, focus.section),
    }
  }
  if (focus.lanes.length === 0) return null
  return {
    kind: 'drum',
    label: focusLabel(focus),
    section: focus.section,
    lanes: focus.lanes.map((lane) => copyDrumLane(pattern, lane.id)),
  }
}

/** Empty the focused material. The cut half of cut-and-paste; the copy has already been taken. */
export function clearFocus(pattern: Pattern, focus: Focus): Pattern {
  if (focus.bass) return clearBassLine(pattern, focus.section)
  let next = pattern
  for (const lane of focus.lanes) next = clearTrack(next, lane.id)
  return next
}

/**
 * Whether the clipboard fits the focus.
 *
 * A 303 line and a drum lane are different shapes and never cross. A single drum lane pastes into any
 * drum lane on any machine, because a kick pattern is a kick pattern. A whole-machine copy stays on its
 * own machine: the 808 and the 909 have different lanes in different order, and lining them up by index
 * would put a rimshot where a clap was and call it a paste.
 */
export function canPasteFocus(clipboard: FocusClipboard | null, focus: Focus): boolean {
  if (!clipboard) return false
  if (clipboard.kind === 'bass') return focus.bass
  if (focus.bass) return false
  return clipboard.lanes.length === 1 || clipboard.section === focus.section
}

/**
 * Paste the clipboard into the focus.
 *
 * A whole-machine clipboard lands on the whole machine whatever the toggle says, because there is
 * nowhere else eleven lanes could go. A single lane lands on the selected lane, like randomise and
 * alter — the toggle is about acting on lanes you cannot see, and one lane has one destination either
 * way.
 *
 * The selected lane rather than the first of `lanes` is the one behaviour change in this split. With
 * the toggle on, `lanes` starts at the machine's first voice, so pasting a copied snare while the
 * button read "Paste Snare into whole 808" quietly replaced the bass drum and left the snare alone.
 */
export function pasteFocus(
  pattern: Pattern,
  clipboard: FocusClipboard | null,
  focus: Focus,
): Pattern {
  if (!clipboard || !canPasteFocus(clipboard, focus)) return pattern
  if (clipboard.kind === 'bass') return pasteBassLine(pattern, focus.section, clipboard.line)
  const targets = clipboard.lanes.length > 1 ? focus.voices : focus.voice ? [focus.voice] : []
  let next = pattern
  targets.forEach((target, index) => {
    const lane = clipboard.lanes[index]
    if (lane) next = pasteDrumLane(next, target.id, lane)
  })
  return next
}

/**
 * The paste button's tooltip, which is the only place the rule above is explained to anybody.
 *
 * It names the destination `pasteFocus` will actually use, so a one-lane paste says the lane even when
 * the toggle beside it is set to the whole machine.
 */
export function pasteTitle(clipboard: FocusClipboard | null, focus: Focus): string {
  if (clipboard && canPasteFocus(clipboard, focus)) {
    const into = clipboard.kind === 'drum' && clipboard.lanes.length === 1
      ? focusedName(focus)
      : focusLabel(focus)
    return `Paste ${clipboard.label} into ${into}`
  }
  if (clipboard?.kind === 'drum' && clipboard.lanes.length > 1) {
    return 'A whole-machine clipboard pastes into the same drum machine'
  }
  return `Copy a ${focus.bass ? '303 line' : 'drum lane or machine'} first`
}
