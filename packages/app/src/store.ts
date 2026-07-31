import { create } from 'zustand'
import {
  ALL_VOICES,
  AUTOMATION_TARGET,
  BASS_VOICES,
  DEFAULT_BASS_PARAMS,
  DEFAULT_FX,
  DEFAULT_SENDS,
  DriftboxEngine,
  REST,
  chainAppend,
  chainBarAt,
  chainMove,
  chainRemove,
  chainSetClip,
  chainSetPattern,
  chainSetRepeat,
  clearBassLine,
  clearTrack,
  copyBassLine,
  copyDrumLane,
  cycleStep,
  encodeSong,
  songBars,
  songPresetById,
  SONGS,
  type SongPreset,
  addPattern,
  alterBassLine,
  alterTrack,
  duplicatePattern,
  randomizeBassLine,
  randomizeTrack,
  pasteBassLine,
  pasteDrumLane,
  removePattern,
  renamePattern,
  rotateBassLine,
  rotateTrack,
  setBassStep,
  setAutomationPoint,
  setStep as setPatternStep,
  toggleFlam,
  transposeBassLine,
  type BassParams,
  type BassLineClipboard,
  type BassStep,
  type ChainStep,
  type ClipSlot,
  type FxParams,
  type DrumLaneClipboard,
  type MachineId,
  type Pattern,
  type SendLevels,
  type Song,
  type StepValue,
  defaultSong,
  type VoiceParams,
  renderMix,
  renderStems,
  toWav,
  voicesUsed,
} from '@driftbox/engine'
import { SCENES, type SceneId } from './visual/scenes'
import type { ScopeMode } from './visual/scope'
import {
  autosave,
  clearStoredSong,
  downloadBlob,
  downloadSong,
  loadCollapsed,
  loadStoredSong,
  pickSongFile,
  saveCollapsed,
  shareLink,
  takeSongFromUrl,
} from './persistence'

// The engine owns the sound; this owns what is on screen. The song is held here as
// immutable data so React can diff it, and pushed into the engine whenever it changes
// — the engine reads it on the audio thread's schedule and never writes to it.

/** Which instrument the grid and the channel strip are showing. The two drum machines
 *  and the 303 rack are three views of one song, not three songs. */
export type View = MachineId | 'bass'
export type PatternClipboard =
  | {
      kind: 'drum'
      label: string
      machine: MachineId
      lanes: DrumLaneClipboard[]
    }
  | {
      kind: 'bass'
      label: string
      lines: BassLineClipboard[]
    }
export interface SongLoop {
  start: number
  bars: number
}

interface State {
  song: Song
  engine: DriftboxEngine | null
  running: boolean
  loop: SongLoop | null
  /** Armed recording is editor state; the points it writes live in `Song.automation`. */
  automationRecording: boolean
  view: View
  /**
   * Which meter is drawn over the scene, and in the editor's scope panel.
   *
   * Shared rather than local to either, so the choice survives moving between vibes and
   * the grid — picking bars on the stage and finding a waveform in the editor would read
   * as two different controls that happen to look alike.
   */
  scope: ScopeMode
  setScope: (mode: ScopeMode) => void
  /** Which pattern the grid is editing. Not necessarily the one playing. */
  editing: string
  /**
   * Whether the grid follows the section being played.
   *
   * On by default, so opening the editor at any point shows what you can hear. Choosing a
   * pattern by hand turns it off — a grid that jumped away from the thing you just picked
   * would be unusable — and loading a song turns it back on.
   */
  followPlayhead: boolean
  selectedVoice: string
  selectedBass: string
  /** 909 step buttons program flam marks instead of cycling hit velocity. */
  flamMode: boolean
  /** Detached editor clipboard. Session state: only cut/paste change the song. */
  patternClipboard: PatternClipboard | null
  /** Full-screen visuals with the sequencer hidden. */
  performance: boolean
  /** The transport thinks it is playing but the audio context is not running — iOS took
   *  it away and has not given it back. See `audio-recovery.ts`. */
  audioStalled: boolean
  /**
   * Which visual is on screen.
   *
   * In the store rather than in App, because loading a song has to be able to change it —
   * every shipped song names the visual it was written to be seen with, and a track
   * change that left the wrong picture up would undo most of the point of pairing them.
   */
  scene: SceneId
  setScene: (scene: SceneId) => void
  /** Panels the user has folded away, by id. Kept out of the Song: which panels you
   *  have open is about your screen, not about the music. */
  collapsed: Record<string, boolean>
  toggleCollapsed: (id: string) => void

  init: () => void
  toggleTransport: () => void
  startAtBar: (bar: number) => void
  toggleSectionLoop: (index: number) => void
  setLoopRange: (start: number, bars: number) => void
  clearSongLoop: () => void
  toggleAutomationRecording: () => void
  clearAutomation: () => void
  setBpm: (bpm: number) => void
  setSwing: (swing: number) => void
  setView: (view: View) => void
  setEditing: (id: string) => void
  setFollowPlayhead: (follow: boolean) => void
  selectVoice: (id: string) => void
  selectBass: (id: string) => void
  toggleStep: (voiceId: string, step: number) => void
  setDrumStep: (voiceId: string, step: number, value: StepValue) => void
  editBassStep: (voiceId: string, step: number, value: BassStep) => void
  toggleFlamMode: () => void
  toggleFlamStep: (voiceId: string, step: number) => void
  setFlamWidth: (value: number) => void
  /** ReBirth-style focused transforms. `all` expands from the selected lane to the
   *  visible machine; it never touches a machine on another editor page. */
  rotateSelection: (delta: number, all: boolean) => void
  randomizeSelection: () => void
  alterSelection: () => void
  transposeSelectedBass: (semitones: number) => void
  copySelection: (all: boolean) => void
  cutSelection: (all: boolean) => void
  pasteSelection: () => void
  clearPattern: () => void
  setParam: (voiceId: string, key: keyof VoiceParams, value: number) => void
  setBassParam: (voiceId: string, key: keyof BassParams, value: number) => void
  setSend: (voiceId: string, key: keyof SendLevels, value: number) => void
  setVoiceSwing: (voiceId: string, value: number) => void
  setFx: (key: keyof FxParams, value: number) => void

  /** The arrangement. Every one of these replaces `song.chain` wholesale. */
  appendChain: (patternId: string) => void
  removeChain: (index: number) => void
  setChainRepeat: (index: number, repeat: number) => void
  setChainPattern: (index: number, patternId: string) => void
  setChainClip: (index: number, slot: ClipSlot, patternId: string) => void
  moveChain: (index: number, delta: number) => void
  setPatternLength: (length: number) => void

  /** The pattern list. Without these the app can only ever arrange what it shipped with. */
  newPattern: () => void
  copyPattern: (id: string) => void
  namePattern: (id: string, name: string) => void
  dropPattern: (id: string) => void

  metronome: boolean
  countIn: boolean
  toggleMetronome: () => void
  toggleCountIn: () => void
  audition: (voiceId: string) => void
  auditionBass: (voiceId: string, step: BassStep) => void
  togglePerformance: () => void

  /** Replace the whole song — from a file, a shared link, or back to the defaults. */
  loadSong: (song: Song) => void
  loadPreset: (id: string) => void
  /** Which shipped song is loaded, or null once it stops being one of them. */
  preset: string | null
  /** Move through the shipped songs. Returns the one landed on, for the UI to announce. */
  stepPreset: (delta: number) => string | null
  /** Whether the song on screen is still byte-identical to the preset it came from —
   *  i.e. whether moving off it would lose anything. */
  pristine: () => boolean
  adoptSharedSong: () => Promise<boolean>
  importSong: () => Promise<boolean>
  exportSong: () => void
  /** Render and save the complete mastered stereo song. */
  exportMix: () => Promise<boolean>
  /** Render one WAV per voice and save them. Returns how many were written. */
  exportStems: () => Promise<number>
  /** Which voice or mix is being rendered, for the progress readout, or null. */
  rendering: string | null
  copyShareLink: () => Promise<string | null>
  resetSong: () => void
}

function replacePattern(song: Song, next: Pattern): Song {
  return { ...song, patterns: song.patterns.map((p) => (p.id === next.id ? next : p)) }
}

function copyFocused(state: State, all: boolean): PatternClipboard | null {
  const pattern = state.song.patterns.find((candidate) => candidate.id === state.editing)
  if (!pattern) return null
  if (state.view === 'bass') {
    const voices = all ? BASS_VOICES : BASS_VOICES.filter((voice) => voice.id === state.selectedBass)
    if (voices.length === 0) return null
    return {
      kind: 'bass',
      label: all ? 'both 303s' : voices[0].name,
      lines: voices.map((voice) => copyBassLine(pattern, voice.id)),
    }
  }
  const voices = all
    ? ALL_VOICES.filter((voice) => voice.machine === state.view)
    : ALL_VOICES.filter((voice) => voice.id === state.selectedVoice)
  if (voices.length === 0) return null
  return {
    kind: 'drum',
    label: all ? `whole ${state.view === 'tr909' ? '909' : '808'}` : voices[0].name,
    machine: state.view,
    lanes: voices.map((voice) => copyDrumLane(pattern, voice.id)),
  }
}

/** Whether this is a touch device, asked once at startup. `pointer: coarse` rather than a
 *  screen width, so a tablet in landscape counts and a small window on a laptop does not. */
function prefersTouch(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

// Last session's work if there is any, the shipped song otherwise. Read synchronously so
// the first render is already the right song — a default song that flickers into the
// user's own a moment later looks like the app lost it and then found it.
const initialSong = loadStoredSong() ?? defaultSong()

/**
 * Which shipped song the restored session is, if it is one of them.
 *
 * Worth the three comparisons at startup: a listener who opened this yesterday, never
 * touched a step and comes back should be able to press next without being asked whether
 * they mind losing work they never did.
 */
const initialPreset =
  SONGS.find((preset) => encodeSong(preset.build()) === encodeSong(initialSong))?.id ?? null

/**
 * The scene a preset asks for, if this build has one by that name.
 *
 * Unknown names are ignored rather than falling back to a default — the engine's `visual`
 * is an opaque hint, and a host is free not to have that picture. A song naming a scene
 * this build does not ship should leave whatever is on screen alone rather than resetting
 * it to something arbitrary.
 */
function visualOf(preset: SongPreset): { scene?: SceneId } {
  const wanted = preset.visual
  return wanted && SCENES.some((s) => s.id === wanted) ? { scene: wanted } : {}
}

/** Apply a pure chain edit and push the result at the engine. */
function withChain(state: State, edit: (song: Song) => ChainStep[]): Partial<State> {
  const song: Song = { ...state.song, chain: edit(state.song) }
  if (state.engine) state.engine.song = song
  return { song }
}

/** Everything that has to move when the song is replaced wholesale. A loaded song has
 *  its own pattern ids, so an `editing` left pointing at the old one edits nothing. */
/**
 * Start the new track at its beginning rather than dropping in wherever the bar counter
 * happened to be.
 *
 * Both ways of changing song need this, and only one of them had it: skipping with
 * next/prev restarted, and picking one from the list did not — so choosing a song while
 * something was playing began it four sections in, which reads as the song not having an
 * intro at all. The gap is one lookahead.
 */
function restart(engine: DriftboxEngine | null, running: boolean): void {
  if (!running || !engine) return
  engine.stop()
  void engine.start()
}

function adopt(song: Song, engine: DriftboxEngine | null): Partial<State> {
  if (engine) {
    // Whatever the last song left ringing goes now. With a three-second room on one of
    // these, the previous track's reverb otherwise hangs over the first bar of the next.
    engine.silenceTails()
    engine.song = song
    engine.bpm = song.bpm
    engine.swing = song.swing
    engine.syncFx()
    engine.clearLoop()
  }
  return {
    song,
    editing: song.patterns[0]?.id ?? '',
    followPlayhead: true,
    loop: null,
    automationRecording: false,
  }
}

function recordPoint(
  song: Song,
  engine: DriftboxEngine | null,
  armed: boolean,
  target: string,
  value: number,
  interpolation: 'hold' | 'linear' = 'linear',
): Song {
  if (!armed || !engine?.running) return song
  const { bar, index } = engine.position
  return setAutomationPoint(song, target, bar, index, value, interpolation)
}

export const useBox = create<State>()((set, get) => ({
  song: initialSong,
  preset: initialPreset,
  engine: null,
  running: false,
  loop: null,
  automationRecording: false,
  view: 'tr808',
  scope: 'wave',
  rendering: null,
  setScope: (scope) => set({ scope }),
  editing: initialSong.patterns[0]?.id ?? '',
  followPlayhead: true,
  metronome: false,
  countIn: false,
  selectedVoice: '808.bd',
  selectedBass: BASS_VOICES[0].id,
  flamMode: false,
  patternClipboard: null,
  // Touch devices land in the visuals.
  //
  // A phone opening on a step grid is opening on the one part of this that a small screen
  // handles worst, and burying the part it handles best. The pad wants a finger and
  // nothing else, so it is the right front door — and the console is one tap away.
  performance: prefersTouch(),
  audioStalled: false,
  // Whatever the restored song suggests, so a returning listener gets the pairing too.
  scene: (initialPreset ? songPresetById(initialPreset)?.visual : undefined) ?? SCENES[0].id,
  collapsed: loadCollapsed(),

  // The AudioContext is created lazily on the first interaction. Constructing one
  // before the user has touched the page leaves it suspended in most browsers, and a
  // suspended context that nobody resumes is the classic "why is it silent".
  init: () => {
    if (get().engine) return
    const engine = new DriftboxEngine(get().song)
    // The engine is built on first interaction, so anything toggled before that — the
    // metronome, a count-in — has to be carried across or it silently does nothing.
    engine.metronome = get().metronome
    engine.countInBars = get().countIn ? 1 : 0
    set({ engine })
  },

  toggleTransport: () => {
    get().init()
    const engine = get().engine
    if (!engine) return
    if (engine.running) {
      engine.stop()
      set({ running: false })
    } else {
      void engine.start().then(() => set({ running: true }))
    }
  },

  startAtBar: (bar) => {
    get().init()
    const engine = get().engine
    if (!engine) return
    if (engine.running) engine.stop()
    void engine.startAt(Math.max(0, Math.floor(bar))).then(() => set({ running: true }))
  },

  toggleSectionLoop: (index) => {
    get().init()
    const { song, engine, loop } = get()
    if (!engine) return
    const step = song.chain[index]
    if (!step) return
    const start = chainBarAt(song, index)
    const bars = Math.max(1, Math.floor(step.repeat))
    if (loop?.start === start && loop.bars === bars) {
      engine.clearLoop()
      set({ loop: null })
      return
    }
    engine.setLoop(start, bars)
    set({ loop: { start, bars } })
  },

  setLoopRange: (start, bars) => {
    get().init()
    const { song, engine } = get()
    if (!engine) return
    const total = Math.max(1, songBars(song))
    const loopStart = Math.max(0, Math.min(total - 1, Math.floor(start)))
    const loopBars = Math.max(1, Math.min(total - loopStart, Math.floor(bars)))
    engine.setLoop(loopStart, loopBars)
    set({ loop: { start: loopStart, bars: loopBars } })
  },

  clearSongLoop: () => {
    const engine = get().engine
    engine?.clearLoop()
    set({ loop: null })
  },

  toggleAutomationRecording: () => {
    set((state) => ({ automationRecording: !state.automationRecording }))
  },

  clearAutomation: () => {
    const { song, engine } = get()
    if (!song.automation?.length) return
    const next: Song = { ...song, automation: undefined }
    if (engine) engine.song = next
    set({ song: next })
  },

  setBpm: (bpm) => {
    const { song, engine, automationRecording } = get()
    const next = recordPoint(
      { ...song, bpm },
      engine,
      automationRecording,
      AUTOMATION_TARGET.bpm,
      bpm,
      'hold',
    )
    if (engine) {
      engine.song = next
      engine.bpm = bpm
    }
    set({ song: next })
  },

  setSwing: (swing) => {
    const { song, engine, automationRecording } = get()
    const next = recordPoint(
      { ...song, swing },
      engine,
      automationRecording,
      AUTOMATION_TARGET.swing,
      swing,
    )
    if (engine) {
      engine.song = next
      engine.swing = swing
    }
    set({ song: next })
  },

  setView: (view) => {
    if (view === 'bass') return set({ view })
    const first = ALL_VOICES.find((v) => v.machine === view)
    set({ view, selectedVoice: first?.id ?? get().selectedVoice })
  },

  setEditing: (editing) => set({ editing, followPlayhead: false }),
  setFollowPlayhead: (followPlayhead) => set({ followPlayhead }),
  selectVoice: (selectedVoice) => set({ selectedVoice }),
  selectBass: (selectedBass) => set({ selectedBass }),

  toggleStep: (voiceId, step) => {
    const { song, editing, engine } = get()
    const pattern = song.patterns.find((p) => p.id === editing)
    if (!pattern) return
    const next = replacePattern(song, cycleStep(pattern, voiceId, step))
    if (engine) engine.song = next
    set({ song: next, selectedVoice: voiceId })
  },

  setDrumStep: (voiceId, step, value) => {
    const { song, editing, engine } = get()
    const pattern = song.patterns.find((p) => p.id === editing)
    if (!pattern) return
    const next = replacePattern(song, setPatternStep(pattern, voiceId, step, value))
    if (engine) engine.song = next
    set({ song: next, selectedVoice: voiceId })
  },

  editBassStep: (voiceId, step, value) => {
    const { song, editing, engine } = get()
    const pattern = song.patterns.find((p) => p.id === editing)
    if (!pattern) return
    const next = replacePattern(song, setBassStep(pattern, voiceId, step, value))
    if (engine) engine.song = next
    set({ song: next, selectedBass: voiceId })
  },

  toggleFlamMode: () => set({ flamMode: !get().flamMode }),

  toggleFlamStep: (voiceId, step) => {
    const { song, editing, engine } = get()
    const pattern = song.patterns.find((candidate) => candidate.id === editing)
    if (!pattern || !voiceId.startsWith('909.')) return
    const next = replacePattern(song, toggleFlam(pattern, voiceId, step))
    if (engine) engine.song = next
    set({ song: next, selectedVoice: voiceId })
  },

  setFlamWidth: (value) => {
    const { song, engine } = get()
    const next = {
      ...song,
      kit: { ...song.kit, flam: Math.max(0, Math.min(1, value)) },
    }
    if (engine) engine.song = next
    set({ song: next })
  },

  rotateSelection: (delta, all) => {
    const { song, editing, engine, view, selectedVoice, selectedBass } = get()
    const pattern = song.patterns.find((p) => p.id === editing)
    if (!pattern) return

    let transformed = pattern
    if (view === 'bass') {
      const voices = all ? BASS_VOICES.map((voice) => voice.id) : [selectedBass]
      for (const voiceId of voices) transformed = rotateBassLine(transformed, voiceId, delta)
    } else {
      const voices = all
        ? ALL_VOICES.filter((voice) => voice.machine === view).map((voice) => voice.id)
        : [selectedVoice]
      for (const voiceId of voices) transformed = rotateTrack(transformed, voiceId, delta)
    }

    if (transformed === pattern) return
    const next = replacePattern(song, transformed)
    if (engine) engine.song = next
    set({ song: next })
  },

  randomizeSelection: () => {
    const { song, editing, engine, view, selectedVoice, selectedBass } = get()
    const pattern = song.patterns.find((p) => p.id === editing)
    if (!pattern) return
    const transformed =
      view === 'bass'
        ? randomizeBassLine(pattern, selectedBass)
        : randomizeTrack(pattern, selectedVoice)
    const next = replacePattern(song, transformed)
    if (engine) engine.song = next
    set({ song: next })
  },

  alterSelection: () => {
    const { song, editing, engine, view, selectedVoice, selectedBass } = get()
    const pattern = song.patterns.find((p) => p.id === editing)
    if (!pattern) return
    const transformed =
      view === 'bass' ? alterBassLine(pattern, selectedBass) : alterTrack(pattern, selectedVoice)
    if (transformed === pattern) return
    const next = replacePattern(song, transformed)
    if (engine) engine.song = next
    set({ song: next })
  },

  transposeSelectedBass: (semitones) => {
    const { song, editing, engine, selectedBass } = get()
    const pattern = song.patterns.find((p) => p.id === editing)
    if (!pattern) return
    const transformed = transposeBassLine(pattern, selectedBass, semitones)
    if (transformed === pattern) return
    const next = replacePattern(song, transformed)
    if (engine) engine.song = next
    set({ song: next })
  },

  copySelection: (all) => {
    const patternClipboard = copyFocused(get(), all)
    if (patternClipboard) set({ patternClipboard })
  },

  cutSelection: (all) => {
    const state = get()
    const pattern = state.song.patterns.find((candidate) => candidate.id === state.editing)
    const patternClipboard = copyFocused(state, all)
    if (!pattern || !patternClipboard) return

    let transformed = pattern
    if (state.view === 'bass') {
      const voices = all ? BASS_VOICES.map((voice) => voice.id) : [state.selectedBass]
      for (const voiceId of voices) transformed = clearBassLine(transformed, voiceId)
    } else {
      const voices = all
        ? ALL_VOICES.filter((voice) => voice.machine === state.view).map((voice) => voice.id)
        : [state.selectedVoice]
      for (const voiceId of voices) transformed = clearTrack(transformed, voiceId)
    }
    const song = replacePattern(state.song, transformed)
    if (state.engine) state.engine.song = song
    set({ song, patternClipboard })
  },

  pasteSelection: () => {
    const state = get()
    const pattern = state.song.patterns.find((candidate) => candidate.id === state.editing)
    const clipboard = state.patternClipboard
    if (!pattern || !clipboard) return

    let transformed = pattern
    if (state.view === 'bass' && clipboard.kind === 'bass') {
      const targets =
        clipboard.lines.length > 1
          ? BASS_VOICES.map((voice) => voice.id)
          : [state.selectedBass]
      targets.forEach((voiceId, index) => {
        const line = clipboard.lines[index]
        if (line) transformed = pasteBassLine(transformed, voiceId, line)
      })
    } else if (
      state.view !== 'bass' &&
      clipboard.kind === 'drum' &&
      (clipboard.lanes.length === 1 || clipboard.machine === state.view)
    ) {
      const targets =
        clipboard.lanes.length > 1
          ? ALL_VOICES.filter((voice) => voice.machine === state.view).map((voice) => voice.id)
          : [state.selectedVoice]
      targets.forEach((voiceId, index) => {
        const lane = clipboard.lanes[index]
        if (lane) transformed = pasteDrumLane(transformed, voiceId, lane)
      })
    } else {
      return
    }

    const song = replacePattern(state.song, transformed)
    if (state.engine) state.engine.song = song
    set({ song })
  },

  clearPattern: () => {
    const { song, editing, engine } = get()
    const pattern = song.patterns.find((p) => p.id === editing)
    if (!pattern) return
    // Everything in the pattern, drums and basslines both. "Clear this pattern" leaving
    // an acid line running underneath would be a surprise, and an unhelpful one.
    const cleared: Pattern = { ...pattern, tracks: {}, bass: {} }
    if (pattern.flams) cleared.flams = {}
    const next = replacePattern(song, cleared)
    if (engine) engine.song = next
    set({ song: next })
  },

  setParam: (voiceId, key, value) => {
    const { song, engine, automationRecording } = get()
    const params: VoiceParams = { ...song.kit.params[voiceId], [key]: value }
    // `...song.kit`, not `{ params }`. The kit carries the 303 settings, the send levels
    // and the per-voice swing as well, and rebuilding it from `params` alone silently
    // dropped all three — turning one drum knob wiped every one of them. It read as
    // correct because it WAS correct when the kit held nothing else.
    const edited: Song = {
      ...song,
      kit: { ...song.kit, params: { ...song.kit.params, [voiceId]: params } },
    }
    const next = recordPoint(
      edited,
      engine,
      automationRecording,
      AUTOMATION_TARGET.voice(voiceId, key),
      value,
    )
    if (engine) engine.song = next
    set({ song: next })
  },

  setBassParam: (voiceId, key, value) => {
    const { song, engine, automationRecording } = get()
    const current = song.kit.bass?.[voiceId] ?? DEFAULT_BASS_PARAMS
    const edited: Song = {
      ...song,
      kit: { ...song.kit, bass: { ...song.kit.bass, [voiceId]: { ...current, [key]: value } } },
    }
    const next = recordPoint(
      edited,
      engine,
      automationRecording,
      AUTOMATION_TARGET.bass(voiceId, key),
      value,
    )
    if (engine) engine.song = next
    set({ song: next })
  },

  setSend: (voiceId, key, value) => {
    const { song, engine, automationRecording } = get()
    const current = song.kit.sends?.[voiceId] ?? DEFAULT_SENDS
    const edited: Song = {
      ...song,
      kit: { ...song.kit, sends: { ...song.kit.sends, [voiceId]: { ...current, [key]: value } } },
    }
    const next = recordPoint(
      edited,
      engine,
      automationRecording,
      AUTOMATION_TARGET.send(voiceId, key),
      value,
    )
    if (engine) engine.song = next
    set({ song: next })
  },

  setVoiceSwing: (voiceId, value) => {
    const { song, engine, automationRecording } = get()
    const edited: Song = {
      ...song,
      kit: { ...song.kit, swing: { ...song.kit.swing, [voiceId]: value } },
    }
    const next = recordPoint(
      edited,
      engine,
      automationRecording,
      AUTOMATION_TARGET.voiceSwing(voiceId),
      value,
    )
    if (engine) engine.song = next
    set({ song: next })
  },

  setFx: (key, value) => {
    const { song, engine, automationRecording } = get()
    const edited: Song = { ...song, fx: { ...(song.fx ?? DEFAULT_FX), [key]: value } }
    const next = recordPoint(
      edited,
      engine,
      automationRecording,
      AUTOMATION_TARGET.fx(key),
      value,
    )
    if (engine) {
      engine.song = next
      engine.syncFx()
    }
    set({ song: next })
  },

  audition: (voiceId) => {
    get().init()
    get().engine?.audition(voiceId)
  },

  auditionBass: (voiceId, step) => {
    get().init()
    get().engine?.auditionBass(voiceId, step)
  },

  setScene: (scene) => set({ scene }),

  togglePerformance: () => set({ performance: !get().performance }),

  toggleCollapsed: (id) => {
    const collapsed = { ...get().collapsed, [id]: !get().collapsed[id] }
    saveCollapsed(collapsed)
    set({ collapsed })
  },

  // The arrangement. One helper because every edit is the same shape: run a pure
  // function over the song's chain, push the result at the engine, keep it on screen.
  appendChain: (patternId) => set(withChain(get(), (s) => chainAppend(s, patternId))),
  removeChain: (index) => set(withChain(get(), (s) => chainRemove(s, index))),
  setChainRepeat: (index, repeat) =>
    set(withChain(get(), (s) => chainSetRepeat(s, index, repeat))),
  setChainPattern: (index, patternId) =>
    set(withChain(get(), (s) => chainSetPattern(s, index, patternId))),
  setChainClip: (index, slot, patternId) =>
    set(withChain(get(), (s) => chainSetClip(s, index, slot, patternId))),
  moveChain: (index, delta) => set(withChain(get(), (s) => chainMove(s, index, delta))),

  setPatternLength: (length) => {
    const { song, editing, engine } = get()
    const pattern = song.patterns.find((p) => p.id === editing)
    if (!pattern) return

    const clamped = Math.max(1, Math.min(64, Math.round(length)))
    // Existing steps are kept and the rest padded with rests, so shortening a pattern
    // and lengthening it again gets the tail back rather than having quietly dropped it.
    const tracks: Record<string, StepValue[]> = {}
    for (const [voiceId, track] of Object.entries(pattern.tracks)) {
      tracks[voiceId] = Array.from({ length: clamped }, (_, i) => track[i] ?? 0)
    }
    const bass: Record<string, BassStep[]> = {}
    for (const [voiceId, line] of Object.entries(pattern.bass ?? {})) {
      bass[voiceId] = Array.from({ length: clamped }, (_, i) => line[i] ?? { ...REST })
    }
    const flams: Record<string, boolean[]> = {}
    for (const [voiceId, marks] of Object.entries(pattern.flams ?? {})) {
      flams[voiceId] = Array.from({ length: clamped }, (_, i) => marks[i] === true)
    }

    const resized: Pattern = { ...pattern, length: clamped, tracks, bass }
    if (pattern.flams) resized.flams = flams
    const next = replacePattern(song, resized)
    if (engine) engine.song = next
    set({ song: next })
  },

  // A new or copied pattern becomes the one being edited. You made it in order to work
  // on it; making you then go and click it would be a small insult.
  newPattern: () => {
    const { song, engine, editing } = get()
    const length = song.patterns.find((p) => p.id === editing)?.length ?? 16
    const { song: next, id } = addPattern(song, length)
    if (engine) engine.song = next
    set({ song: next, editing: id, followPlayhead: false })
  },

  copyPattern: (id) => {
    const { song, engine } = get()
    const { song: next, id: copy } = duplicatePattern(song, id)
    if (engine) engine.song = next
    set({ song: next, editing: copy, followPlayhead: false })
  },

  namePattern: (id, name) => {
    const { song, engine } = get()
    const next = renamePattern(song, id, name)
    if (engine) engine.song = next
    set({ song: next })
  },

  dropPattern: (id) => {
    const { song, engine, editing } = get()
    const next = removePattern(song, id)
    if (next === song) return
    if (engine) engine.song = next
    // If the grid was showing the one that just went, show something that still exists.
    set({ song: next, editing: editing === id ? next.patterns[0].id : editing })
  },

  toggleMetronome: () => {
    const metronome = !get().metronome
    const engine = get().engine
    if (engine) engine.metronome = metronome
    set({ metronome })
  },

  toggleCountIn: () => {
    const countIn = !get().countIn
    const engine = get().engine
    if (engine) engine.countInBars = countIn ? 1 : 0
    set({ countIn })
  },

  loadSong: (song) => set(adopt(song, get().engine)),

  loadPreset: (id) => {
    const preset = songPresetById(id)
    if (!preset) return
    const { engine, running } = get()
    // build(), not a stored object — each call is a fresh song, so loading one twice
    // cannot hand back something edited in between.
    set({ ...adopt(preset.build(), engine), preset: preset.id, ...visualOf(preset) })
    restart(engine, running)
  },

  stepPreset: (delta) => {
    const { preset, running, engine } = get()
    const at = SONGS.findIndex((s) => s.id === preset)
    // Unknown song — somebody's own, or a loaded file. Start from the top rather than
    // from nowhere, so next always goes somewhere.
    const next = SONGS[(((at < 0 ? 0 : at + delta) % SONGS.length) + SONGS.length) % SONGS.length]

    set({ ...adopt(next.build(), engine), preset: next.id, ...visualOf(next) })

    restart(engine, running)
    return next.name
  },

  pristine: () => {
    const { song, preset } = get()
    const found = preset ? songPresetById(preset) : undefined
    if (!found) return false
    return encodeSong(song) === encodeSong(found.build())
  },

  adoptSharedSong: async () => {
    const song = await takeSongFromUrl()
    if (!song) return false
    set(adopt(song, get().engine))
    return true
  },

  importSong: async () => {
    const song = await pickSongFile()
    if (!song) return false
    set(adopt(song, get().engine))
    return true
  },

  exportSong: () => downloadSong(get().song),

  exportMix: async () => {
    const { song, preset } = get()
    set({ rendering: 'mix' })
    try {
      const buffer = await renderMix(song)
      const name = (preset ?? 'song').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
      downloadBlob(toWav(buffer), `driftbox-${name}-mix.wav`)
      return true
    } finally {
      set({ rendering: null })
    }
  },

  exportStems: async () => {
    const { song } = get()
    const voices = voicesUsed(song)
    if (voices.length === 0) return 0
    // Rendered one at a time with the store updated between, so the button can say which
    // voice it is on. A whole song per voice is seconds of work even offline, and a
    // control that looks frozen for that long reads as broken.
    let written = 0
    for (const id of voices) {
      set({ rendering: id })
      const [stem] = await renderStems(song, { only: [id] })
      if (!stem) continue
      const safe = stem.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      downloadBlob(toWav(stem.buffer), `driftbox-${written + 1}-${safe}.wav`)
      written++
      // A beat between saves. Browsers batch downloads fired in one tick and drop most.
      await new Promise((done) => setTimeout(done, 120))
    }
    set({ rendering: null })
    return written
  },

  copyShareLink: async () => {
    const url = await shareLink(get().song)
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // No clipboard permission, or an insecure origin. The URL is still returned, so
      // the caller can show it and let the user copy it themselves.
    }
    return url
  },

  resetSong: () => {
    // The autosave has to go too, or the next reload restores what was just discarded.
    clearStoredSong()
    set(adopt(defaultSong(), get().engine))
  },
}))

// Autosave. Subscribing here rather than writing inside every action means there is one
// place that knows about persistence, and no way to add an edit that quietly is not
// saved — which is the failure this whole feature exists to prevent.
useBox.subscribe((state, previous) => {
  if (state.song !== previous.song) autosave(state.song)
})
