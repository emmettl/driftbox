import { create } from 'zustand'
import {
  ALL_VOICES,
  BASS_VOICES,
  DEFAULT_BASS_PARAMS,
  DEFAULT_FX,
  DEFAULT_SENDS,
  DriftboxEngine,
  REST,
  chainAppend,
  chainMove,
  chainRemove,
  chainSetPattern,
  chainSetRepeat,
  cycleStep,
  addPattern,
  duplicatePattern,
  removePattern,
  renamePattern,
  setBassStep,
  type BassParams,
  type BassStep,
  type ChainStep,
  type FxParams,
  type MachineId,
  type Pattern,
  type SendLevels,
  type Song,
  type StepValue,
  defaultSong,
  type VoiceParams,
} from '@driftbox/engine'
import {
  autosave,
  clearStoredSong,
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

interface State {
  song: Song
  engine: DriftboxEngine | null
  running: boolean
  view: View
  /** Which pattern the grid is editing. Not necessarily the one playing. */
  editing: string
  selectedVoice: string
  selectedBass: string
  /** Full-screen visuals with the sequencer hidden. */
  performance: boolean
  /** Panels the user has folded away, by id. Kept out of the Song: which panels you
   *  have open is about your screen, not about the music. */
  collapsed: Record<string, boolean>
  toggleCollapsed: (id: string) => void

  init: () => void
  toggleTransport: () => void
  setBpm: (bpm: number) => void
  setSwing: (swing: number) => void
  setView: (view: View) => void
  setEditing: (id: string) => void
  selectVoice: (id: string) => void
  selectBass: (id: string) => void
  toggleStep: (voiceId: string, step: number) => void
  editBassStep: (voiceId: string, step: number, value: BassStep) => void
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
  adoptSharedSong: () => Promise<boolean>
  importSong: () => Promise<boolean>
  exportSong: () => void
  copyShareLink: () => Promise<string | null>
  resetSong: () => void
}

function replacePattern(song: Song, next: Pattern): Song {
  return { ...song, patterns: song.patterns.map((p) => (p.id === next.id ? next : p)) }
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

/** Apply a pure chain edit and push the result at the engine. */
function withChain(state: State, edit: (song: Song) => ChainStep[]): Partial<State> {
  const song: Song = { ...state.song, chain: edit(state.song) }
  if (state.engine) state.engine.song = song
  return { song }
}

/** Everything that has to move when the song is replaced wholesale. A loaded song has
 *  its own pattern ids, so an `editing` left pointing at the old one edits nothing. */
function adopt(song: Song, engine: DriftboxEngine | null): Partial<State> {
  if (engine) {
    engine.song = song
    engine.bpm = song.bpm
    engine.swing = song.swing
    engine.syncFx()
  }
  return { song, editing: song.patterns[0]?.id ?? '' }
}

export const useBox = create<State>()((set, get) => ({
  song: initialSong,
  engine: null,
  running: false,
  view: 'tr808',
  editing: initialSong.patterns[0]?.id ?? '',
  metronome: false,
  countIn: false,
  selectedVoice: '808.bd',
  selectedBass: BASS_VOICES[0].id,
  // Touch devices land in the visuals.
  //
  // A phone opening on a step grid is opening on the one part of this that a small screen
  // handles worst, and burying the part it handles best. The pad wants a finger and
  // nothing else, so it is the right front door — and the console is one tap away.
  performance: prefersTouch(),
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

  setBpm: (bpm) => {
    const song = { ...get().song, bpm }
    const engine = get().engine
    if (engine) engine.bpm = bpm
    set({ song })
  },

  setSwing: (swing) => {
    const song = { ...get().song, swing }
    const engine = get().engine
    if (engine) engine.swing = swing
    set({ song })
  },

  setView: (view) => {
    if (view === 'bass') return set({ view })
    const first = ALL_VOICES.find((v) => v.machine === view)
    set({ view, selectedVoice: first?.id ?? get().selectedVoice })
  },

  setEditing: (editing) => set({ editing }),
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

  editBassStep: (voiceId, step, value) => {
    const { song, editing, engine } = get()
    const pattern = song.patterns.find((p) => p.id === editing)
    if (!pattern) return
    const next = replacePattern(song, setBassStep(pattern, voiceId, step, value))
    if (engine) engine.song = next
    set({ song: next, selectedBass: voiceId })
  },

  clearPattern: () => {
    const { song, editing, engine } = get()
    const pattern = song.patterns.find((p) => p.id === editing)
    if (!pattern) return
    // Everything in the pattern, drums and basslines both. "Clear this pattern" leaving
    // an acid line running underneath would be a surprise, and an unhelpful one.
    const next = replacePattern(song, { ...pattern, tracks: {}, bass: {} })
    if (engine) engine.song = next
    set({ song: next })
  },

  setParam: (voiceId, key, value) => {
    const { song, engine } = get()
    const params: VoiceParams = { ...song.kit.params[voiceId], [key]: value }
    // `...song.kit`, not `{ params }`. The kit carries the 303 settings, the send levels
    // and the per-voice swing as well, and rebuilding it from `params` alone silently
    // dropped all three — turning one drum knob wiped every one of them. It read as
    // correct because it WAS correct when the kit held nothing else.
    const next: Song = {
      ...song,
      kit: { ...song.kit, params: { ...song.kit.params, [voiceId]: params } },
    }
    if (engine) engine.song = next
    set({ song: next })
  },

  setBassParam: (voiceId, key, value) => {
    const { song, engine } = get()
    const current = song.kit.bass?.[voiceId] ?? DEFAULT_BASS_PARAMS
    const next: Song = {
      ...song,
      kit: { ...song.kit, bass: { ...song.kit.bass, [voiceId]: { ...current, [key]: value } } },
    }
    if (engine) engine.song = next
    set({ song: next })
  },

  setSend: (voiceId, key, value) => {
    const { song, engine } = get()
    const current = song.kit.sends?.[voiceId] ?? DEFAULT_SENDS
    const next: Song = {
      ...song,
      kit: { ...song.kit, sends: { ...song.kit.sends, [voiceId]: { ...current, [key]: value } } },
    }
    if (engine) engine.song = next
    set({ song: next })
  },

  setVoiceSwing: (voiceId, value) => {
    const { song, engine } = get()
    const next: Song = {
      ...song,
      kit: { ...song.kit, swing: { ...song.kit.swing, [voiceId]: value } },
    }
    if (engine) engine.song = next
    set({ song: next })
  },

  setFx: (key, value) => {
    const { song, engine } = get()
    const next: Song = { ...song, fx: { ...(song.fx ?? DEFAULT_FX), [key]: value } }
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

    const next = replacePattern(song, { ...pattern, length: clamped, tracks, bass })
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
    set({ song: next, editing: id })
  },

  copyPattern: (id) => {
    const { song, engine } = get()
    const { song: next, id: copy } = duplicatePattern(song, id)
    if (engine) engine.song = next
    set({ song: next, editing: copy })
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
