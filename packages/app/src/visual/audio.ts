// What the scenes are looking at.
//
// **A plain mutable module object rather than store state, and rather than context — the same decision
// `touch.ts` makes, for the same reason.** Every scene reads these inside `useFrame`, sixty times a second,
// and none of them re-renders when one changes: `running` is read inside the frame callback in the two
// scenes that use it, and the tempo was already being read imperatively through `useBox.getState()` for
// exactly this reason. Reactivity would buy a render per transport change and change nothing on screen.
//
// **Why it exists at all: the scenes were welded to the sequencer.** Every one of them did
// `useBox((s) => s.engine)` and handed that to `readLevels`, which only ever wanted `engine.analyser`. So
// thirteen scenes each depended on the whole sequencer — its store, its songs, its engine — to reach one
// `AnalyserNode`. That made them unusable from the rack, which has its own graph and its own analyser and
// is a 38kB page that cannot afford to import a sequencer to get at a scene.
//
// It is the same fix the Oscilloscope had: the coupling was one field deep and entirely accidental, and
// removing it is what makes the component shared rather than adding a fallback to it. The difference is
// that the Oscilloscope takes a prop, and a scene cannot — it is rendered from a registry by id, so there
// is nowhere to thread one through. Hence a published object: whoever mounts the `Visualiser` says what
// the scenes are watching, once, and the scenes read it.
//
// The default is silence at 120bpm, so a scene mounted before any audio exists animates gently rather
// than dividing by nothing. That is the state the sequencer's own page is in before the first tap.

export interface SceneAudio {
  /** The mix, for `readLevels` and `readBands`. Null before audio has started. */
  analyser: AnalyserNode | null
  /** Whether the transport is running. Scenes that travel stand still when it is not. */
  running: boolean
  /** The transport's tempo, so a scene can dance ON the record rather than merely near it. */
  bpm: number
}

export const sceneAudio: SceneAudio = {
  analyser: null,
  running: false,
  bpm: 120,
}

/**
 * Say what the scenes are watching. Called by whichever page has mounted the `Visualiser`.
 *
 * Assigns field by field rather than replacing the object, because the scenes hold a reference to it —
 * `sceneAudio` is imported once per module and read every frame, so swapping the object would leave every
 * scene reading the old one for ever. The kind of bug that looks like "the visualiser stopped responding
 * to the music" and has nothing to do with audio.
 */
export function setSceneAudio(next: Partial<SceneAudio>): void {
  if (next.analyser !== undefined) sceneAudio.analyser = next.analyser
  if (next.running !== undefined) sceneAudio.running = next.running
  if (next.bpm !== undefined) sceneAudio.bpm = next.bpm
}

/** Back to silence. For a page unmounting its visualiser, and for a test that must not inherit the last
 *  one's analyser. */
export function resetSceneAudio(): void {
  sceneAudio.analyser = null
  sceneAudio.running = false
  sceneAudio.bpm = 120
}
