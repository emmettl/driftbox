import { MODULES, type Patch } from '@driftbox/rack'

// Guided tours of the rack, as data.
//
// **The tours watch the rack; they never drive it.** No step is completed by pressing Next, and no step
// moves a knob or drops a module on your behalf. A step is a claim about the patch — "there is a Ladder in
// it", "something reaches an Out", "an LFO feeds a control inlet" — and it ticks when that claim becomes
// true because you made it true. Nothing else was ever going to work here: a tour that patched the cable
// for you would leave somebody watching a demo of a thing they still could not do, and the rack's whole
// difficulty is that its concepts are invisible until your own hand has made one.
//
// It has a second consequence that matters more than it sounds: **a tour cannot be got out of step**.
// There is no script position to lose. Do the steps out of order, wander off and load a patch, undo half
// of it, come back an hour later — the predicates are re-evaluated against whatever the rack is now, and
// the tour is wherever it truly is. That is also why they are cheap: no recorded sequence, no synthetic
// events, no shadow copy of the rack to keep in agreement with the real one.
//
// **Pure, and separate from the UI on purpose.** Everything here is a function of a plain snapshot, so the
// interesting half — is this step reachable, does this lesson actually end somewhere audible — is a Node
// test rather than something you find out by driving a browser. `TutorialCoach.tsx` is only the panel.
//
// The lessons deliberately teach what the rack already does rather than what a modular is in general.
// Three of the five hardest things to discover here are conveniences: a source arrives wired to its own
// Out, the keyboard builds a MIDI module the first time you press a key, and a filter does *not* arrive
// wired to anything. Every one of those is good behaviour that is invisible until somebody says it.

export interface TutorialState {
  patch: Patch
  /** Audio has been started. Nothing in the rack makes a sound before this. */
  started: boolean
  /** The rack transport is running. */
  playing: boolean
  /** Looking at the back panel. */
  flipped: boolean
  /** ● Rec is armed. */
  automating: boolean
  /** How many notes are sounding right now. */
  sounding: number
  /** The automation desk is open. */
  automationOpen: boolean
}

export interface TutorialStep {
  id: string
  /** The instruction, imperative and one line. */
  title: string
  /** Why it is worth doing, or what just happened. Two sentences at most. */
  body: string
  /** Where to look. Rendered as a chip, so keep it to a couple of words. */
  where: string
  /**
   * What to point the beacon at: CSS selectors, most specific first, first match wins.
   *
   * Selectors rather than refs, because this file is data and must stay free of the DOM — and because the
   * control a step names often does not exist yet. See `spotlight.ts` for how a list becomes one moving
   * target, and `isAimable` for the four attributes a tour is allowed to name.
   *
   * Optional, and left off deliberately more often than not. A step whose target is the keyboard across
   * the bottom of the screen, or "any knob", does not need an arrow drawn to it — and a beacon on every
   * step of every tour is the decoration `PlayBeacon` was written not to be.
   */
  spotlight?: readonly string[]
  done(state: TutorialState): boolean
}

export interface Tutorial {
  id: string
  name: string
  blurb: string
  /** Roughly, for the card. Nobody believes these; they exist to say "short" or "not short". */
  minutes: number
  steps: readonly TutorialStep[]
}

// ---- Predicates ---------------------------------------------------------------------------------
//
// Exported because they are the interesting part and are tested directly, and because a step body reads
// better as `audible(patch, 'ladder')` than as a walk over cables written out eight times.

/** Every module of one type. */
const of = (patch: Patch, type: string) => patch.modules.filter((module) => module.type === type)

export const has = (patch: Patch, type: string): boolean =>
  patch.modules.some((module) => module.type === type)

/** Any of these types, for a step that does not care which instrument you brought. */
export const hasAny = (patch: Patch, types: readonly string[]): boolean =>
  types.some((type) => has(patch, type))

/**
 * Is there a cable out of a module of `fromType` into one of `toType`, optionally at a named inlet?
 *
 * By type rather than by id throughout, because the ids belong to the person taking the tour — they
 * added the module, so it is `ladder-3` and no step could have known that.
 */
export function patched(
  patch: Patch,
  fromType: string,
  toType?: string,
  toPort?: string,
): boolean {
  const from = new Set(of(patch, fromType).map((module) => module.id))
  const to =
    toType === undefined ? null : new Set(of(patch, toType).map((module) => module.id))
  return patch.cables.some(
    (cable) =>
      from.has(cable.from[0]) &&
      (to === null || to.has(cable.to[0])) &&
      (toPort === undefined || cable.to[1] === toPort),
  )
}

/** Is anything at all plugged into this type's named inlet? */
export const fed = (patch: Patch, type: string, port: string): boolean => {
  const targets = new Set(of(patch, type).map((module) => module.id))
  return patch.cables.some((cable) => targets.has(cable.to[0]) && cable.to[1] === port)
}

/**
 * Does anything of this type have a path down cables to a terminal module?
 *
 * The one predicate worth writing carefully. "Is it plugged in" is not the question anybody means — a
 * Ladder cabled into a Delay cabled into nothing is plugged in and silent — and the rack allows feedback
 * loops, so the walk needs a visited set or a patch with a cycle in it hangs the panel.
 */
export function audible(patch: Patch, type: string): boolean {
  const downstream = new Map<string, string[]>()
  for (const cable of patch.cables) {
    const list = downstream.get(cable.from[0])
    if (list) list.push(cable.to[0])
    else downstream.set(cable.from[0], [cable.to[0]])
  }
  const terminal = new Set(
    patch.modules.filter((module) => MODULES[module.type]?.terminal).map((module) => module.id),
  )

  for (const start of of(patch, type)) {
    const seen = new Set<string>([start.id])
    const queue = [start.id]
    while (queue.length > 0) {
      for (const next of downstream.get(queue.pop()!) ?? []) {
        if (terminal.has(next)) return true
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return false
}

/**
 * Has a knob on this type of module been moved off the value the def ships it at?
 *
 * Against the def rather than against a remembered starting value, deliberately. A remembered one would
 * make the step un-tickable for somebody who loaded a preset that had already moved the knob — and they
 * have not been cheated of the lesson, they arrived having already learnt it somewhere else.
 */
export function paramMoved(patch: Patch, type: string, paramId?: string): boolean {
  const def = MODULES[type]
  if (!def) return false
  return of(patch, type).some((module) =>
    Object.entries(module.params ?? {}).some(([id, value]) => {
      if (paramId !== undefined && id !== paramId) return false
      const param = def.params.find((candidate) => candidate.id === id)
      return param !== undefined && !param.hidden && param.default !== value
    }),
  )
}

/** Has any rear-panel input trim been moved off unity? Absent means 1×, so absence is not a move. */
export const trimmed = (patch: Patch): boolean =>
  patch.modules.some((module) =>
    Object.values(module.inputTrims ?? {}).some((value) => value !== 1),
  )

// ---- The lessons --------------------------------------------------------------------------------

const step = (
  id: string,
  where: string,
  title: string,
  body: string,
  done: (state: TutorialState) => boolean,
  spotlight?: readonly string[],
): TutorialStep => ({ id, where, title, body, done, spotlight })

/** Point at the picker until it opens, then at the card inside it. One instruction, two targets. */
const inPicker = (type: string): readonly string[] => [
  `.rk-card[data-module="${type}"]`,
  '[data-beacon="add"]',
]

export const TUTORIALS: readonly Tutorial[] = [
  {
    id: 'first-sound',
    name: 'A sound of your own',
    blurb: 'Add an instrument and play it. Nothing to patch yet.',
    minutes: 3,
    steps: [
      step(
        'start',
        'Header',
        'Press Start audio.',
        'A browser will not make a sound until you ask it to, so the whole rack is silent until this. It is the only step you cannot skip past.',
        (state) => state.started,
        ['[data-beacon="transport"]'],
      ),
      step(
        'voice',
        'Add module',
        'Add module → Sources → Voice.',
        'A Voice is a whole synth in one device. Watch what happens behind it: anything on the Sources shelf arrives already wired to its own Out channel, so you have not been handed a silent rectangle.',
        (state) => has(state.patch, 'voice'),
        inPicker('voice'),
      ),
      step(
        'play',
        'Keyboard',
        'Play the keyboard along the bottom.',
        'The first note you press builds a MIDI module and cables it to the newest instrument. That is why this works before you have patched anything.',
        (state) => state.sounding > 0 || has(state.patch, 'midi'),
      ),
      step(
        'flip',
        'Tab',
        'Press Tab to turn the rack around.',
        'Two cables you did not draw: pitch and gate, from MIDI to the Voice. Every convenience in this rack is an ordinary cable you can move or unplug.',
        (state) => state.flipped,
        ['[data-beacon="flip"]'],
      ),
      step(
        'knob',
        'Voice panel',
        'Turn back and move a knob on the Voice.',
        'Drag vertically. Shift is fine movement, arrow keys work when a knob has focus, and a double-click puts it back at the middle.',
        (state) => paramMoved(state.patch, 'voice'),
        ['[data-module-type="voice"]'],
      ),
    ],
  },
  {
    id: 'patch-by-hand',
    name: 'Your first cable',
    blurb: 'A filter arrives connected to nothing. Wire it in.',
    minutes: 4,
    steps: [
      step(
        'ladder',
        'Add module',
        'Add module → Filters → Ladder.',
        'Nothing happens, and that is the lesson. Only sources auto-connect: a processor cannot guess what it is meant to be processing, so it waits.',
        (state) => has(state.patch, 'ladder'),
        inPicker('ladder'),
      ),
      step(
        'flip',
        'Tab',
        'Turn the rack around.',
        'Inputs and outputs live on the back. Drag between two jacks in either direction — one output can feed many places, but an input takes one cable and a second replaces the first.',
        (state) => state.flipped,
        ['[data-beacon="flip"]'],
      ),
      step(
        'in',
        'Back panel',
        'Patch an instrument’s Out into the Ladder’s In.',
        'Take the cable that currently reaches an Out module and land it here instead. The Out module goes quiet, which is correct: you have just cut the chain in half.',
        (state) => fed(state.patch, 'ladder', 'in'),
        ['[data-module-type="ladder"]'],
      ),
      step(
        'out',
        'Back panel',
        'Patch the Ladder’s Out into an Out module’s In.',
        'The chain is whole again, with the filter in the middle of it. Out is the only place audio leaves the rack — no Out, no sound, however well the rest is wired.',
        (state) => audible(state.patch, 'ladder'),
        ['[data-module-type="ladder"]'],
      ),
      step(
        'cutoff',
        'Ladder panel',
        'Turn back and close the Cutoff.',
        'Then bring the Res up. This is the 303’s filter: four poles, saturating, and it will self-oscillate near the top of the Res knob.',
        (state) => paramMoved(state.patch, 'ladder', 'cutoff'),
        ['[data-module-type="ladder"]'],
      ),
    ],
  },
  {
    id: 'make-it-move',
    name: 'Make it move',
    blurb: 'An LFO into a control inlet, and how to set the depth.',
    minutes: 4,
    steps: [
      step(
        'lfo',
        'Add module',
        'Add module → Modulation → LFO.',
        'An LFO makes no sound. It makes a slow signal, and a signal only becomes control because of the inlet it arrives at.',
        (state) => has(state.patch, 'lfo'),
        inPicker('lfo'),
      ),
      step(
        'patch',
        'Back panel',
        'Patch the LFO’s Bi output into a Cutoff inlet.',
        'Bi swings either side of zero, so the filter moves up and down around wherever you left the knob. Uni only ever adds.',
        (state) => patched(state.patch, 'lfo'),
        ['[data-module-type="lfo"]'],
      ),
      step(
        'rate',
        'LFO panel',
        'Set the Rate.',
        'Below about 20 Hz it is movement; above that it stops being a wobble and starts being a tone. The same module does both.',
        (state) => paramMoved(state.patch, 'lfo', 'rate'),
        ['[data-module-type="lfo"]'],
      ),
      step(
        'shape',
        'LFO panel',
        'Change the Shape.',
        'A triangle sweeps, a square switches between two states, and the stepped shape is a random value held until the next cycle.',
        (state) => paramMoved(state.patch, 'lfo', 'shape'),
        ['[data-module-type="lfo"]'],
      ),
      step(
        'trim',
        'Back panel',
        'Turn down the trim beside that inlet.',
        'The small control next to every input scales what arrives — and its negative half inverts it. This is how you get *some* modulation instead of all of it, and it is the control people look hardest for.',
        (state) => trimmed(state.patch),
      ),
    ],
  },
  {
    id: 'sequence-it',
    name: 'Let it play itself',
    blurb: 'A clock, eight steps, and something to point them at.',
    minutes: 5,
    steps: [
      step(
        'seq',
        'Add module',
        'Add module → Sequencing → Seq.',
        'Eight pitch knobs and a switch under each. There is no clock inside it, which is why it does nothing at all yet.',
        (state) => has(state.patch, 'seq'),
        inPicker('seq'),
      ),
      step(
        'transport',
        'Add module',
        'Add a Transport.',
        'Transport knows the tempo in the header and turns it into bars, beats and sixteenths. It is what makes a patch agree with the BPM box instead of with itself.',
        (state) => has(state.patch, 'transport'),
        inPicker('transport'),
      ),
      step(
        'clock',
        'Back panel',
        'Patch Transport 1/16 into the Seq’s Clock.',
        'One edge, one step. Patch the same 1/16 into a second sequencer and the two stay in phase for ever — which two self-clocking modules could never quite manage.',
        (state) => patched(state.patch, 'transport', 'seq', 'clock'),
        ['[data-module-type="seq"]'],
      ),
      step(
        'pitch',
        'Back panel',
        'Patch Seq Pitch into an instrument’s V/Oct, and Gate into its Gate.',
        'Pitch says which note, Gate says when and for how long. They are separate cables because plenty of useful patches want one without the other.',
        (state) => patched(state.patch, 'seq', undefined, 'pitch'),
        ['[data-module-type="seq"]'],
      ),
      step(
        'play',
        'Header',
        'Press Play.',
        'The Seq’s gate is the clock’s gate and the step’s switch, together — so the note length comes from the Clock’s Width, and turning it shortens every step at once.',
        (state) => state.playing,
        ['[data-beacon="transport"]'],
      ),
      step(
        'line',
        'Seq panel',
        'Write a line: move the pitch knobs, and switch some steps off.',
        'The rests are what make it a riff rather than a scale. The small patch name above the panel has factory lines in it if you would rather start from one.',
        (state) => paramMoved(state.patch, 'seq'),
        ['[data-module-type="seq"]'],
      ),
    ],
  },
  {
    id: 'macros',
    name: 'Four knobs that play the patch',
    blurb: 'The Combinator, and why it is not a container.',
    minutes: 4,
    steps: [
      step(
        'combi',
        'Add module',
        'Add module → Modulation → Combi.',
        'Four rotaries and four buttons that reach any parameter anywhere in the rack. It holds no devices — it points at them, which is why nothing needs to be inside it.',
        (state) => has(state.patch, 'combi'),
        inPicker('combi'),
      ),
      step(
        'route',
        'Combi panel',
        'Open Routing and aim Rotary 1 at a knob.',
        'Pick something worth performing: a filter cutoff, a delay feedback, a level. The target keeps its own knob and stays editable; the routing just decides its live value.',
        (state) => (state.patch.modulation?.length ?? 0) >= 1,
        ['[data-module-type="combi"]'],
      ),
      step(
        'range',
        'Combi panel',
        'Aim a second rotary somewhere else.',
        'Each routing has its own min and max, so one rotary can sweep a filter across two useful octaves rather than across everything the knob can physically do.',
        (state) => (state.patch.modulation?.length ?? 0) >= 2,
        ['[data-module-type="combi"]'],
      ),
      step(
        'turn',
        'Combi panel',
        'Turn Rotary 1 and listen.',
        'A parameter under a routing is marked on its own panel, so you can always find out what is moving a knob you did not touch.',
        (state) => paramMoved(state.patch, 'combi', 'rotary1'),
        ['[data-module-type="combi"]'],
      ),
    ],
  },
  {
    id: 'record-a-move',
    name: 'Record a knob move',
    blurb: 'Arm, perform, then draw the take by hand.',
    minutes: 3,
    steps: [
      step(
        'run',
        'Header',
        'Start audio and press Play.',
        'Automation is recorded against the rack’s timeline, so there has to be one running before there is anywhere to put a move.',
        (state) => state.started && state.playing,
        ['[data-beacon="transport"]'],
      ),
      step(
        'arm',
        'Header',
        'Press ● Rec.',
        'It arms every knob in the rack at once. A per-module arm would mean choosing the knob before you knew you wanted to move it, which is not how performing works.',
        (state) => state.automating,
        ['[data-beacon="rec"]'],
      ),
      step(
        'move',
        'Any panel',
        'Move a knob while it runs.',
        'The count on the Automation button is how many lanes you now have. Play it back and the move happens again at the same point in the bar.',
        (state) => (state.patch.automation?.length ?? 0) > 0,
      ),
      step(
        'desk',
        'Header',
        'Open Automation.',
        'Every lane, as points you can drag, place by bar and step, or draw with the Pencil. Stepped parameters stay on hold curves so a sweep never passes through a setting that does not exist.',
        (state) => state.automationOpen,
        ['[data-beacon="automation"]'],
      ),
    ],
  },
]

export const tutorialById = (id: string): Tutorial | undefined =>
  TUTORIALS.find((tutorial) => tutorial.id === id)

// ---- What this browser has already been through ------------------------------------------------
//
// Same shape and the same defensiveness as `device-library.ts` and `useFirstRun.ts`, and kept apart from
// both for the reason `useFirstRun` gives: this is about the person, not the music, so resetting a patch
// must not make the rack start teaching itself again.

const KEY = 'driftbox.rack.tours.v1'

export interface Store {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function browserStore(): Store | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** The ids of the tours this browser has finished. Unknown ids are dropped: a lesson may have been renamed. */
export function finishedTours(store: Store | null = browserStore()): Set<string> {
  if (!store) return new Set()
  try {
    const raw = store.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed.filter(
        (id): id is string => typeof id === 'string' && tutorialById(id) !== undefined,
      ),
    )
  } catch {
    // Private browsing, a full quota, or somebody's junk under our key. Never knowing is better than
    // never rendering.
    return new Set()
  }
}

/** Record one as finished, and hand back the complete set so a caller need not re-read. */
export function finishTour(id: string, store: Store | null = browserStore()): Set<string> {
  const done = finishedTours(store).add(id)
  try {
    store?.setItem(KEY, JSON.stringify([...done]))
  } catch {
    // Remembering for this session only is a fine outcome.
  }
  return done
}
