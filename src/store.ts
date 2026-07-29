import { create } from 'zustand'
import {
  ALL_VOICES,
  DriftboxEngine,
  cycleStep,
  type MachineId,
  type Pattern,
  type Song,
  type VoiceParams,
} from './engine'
import { defaultSong } from './songs'

// The engine owns the sound; this owns what is on screen. The song is held here as
// immutable data so React can diff it, and pushed into the engine whenever it changes
// — the engine reads it on the audio thread's schedule and never writes to it.

interface State {
  song: Song
  engine: DriftboxEngine | null
  running: boolean
  machine: MachineId
  /** Which pattern the grid is editing. Not necessarily the one playing. */
  editing: string
  selectedVoice: string
  /** Full-screen visuals with the sequencer hidden. */
  performance: boolean

  init: () => void
  toggleTransport: () => void
  setBpm: (bpm: number) => void
  setSwing: (swing: number) => void
  setMachine: (machine: MachineId) => void
  setEditing: (id: string) => void
  selectVoice: (id: string) => void
  toggleStep: (voiceId: string, step: number) => void
  clearPattern: () => void
  setParam: (voiceId: string, key: keyof VoiceParams, value: number) => void
  audition: (voiceId: string) => void
  togglePerformance: () => void
}

function replacePattern(song: Song, next: Pattern): Song {
  return { ...song, patterns: song.patterns.map((p) => (p.id === next.id ? next : p)) }
}

export const useBox = create<State>()((set, get) => ({
  song: defaultSong(),
  engine: null,
  running: false,
  machine: 'tr808',
  editing: 'drift',
  selectedVoice: '808.bd',
  performance: false,

  // The AudioContext is created lazily on the first interaction. Constructing one
  // before the user has touched the page leaves it suspended in most browsers, and a
  // suspended context that nobody resumes is the classic "why is it silent".
  init: () => {
    if (get().engine) return
    set({ engine: new DriftboxEngine(get().song) })
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

  setMachine: (machine) => {
    const first = ALL_VOICES.find((v) => v.machine === machine)
    set({ machine, selectedVoice: first?.id ?? get().selectedVoice })
  },

  setEditing: (editing) => set({ editing }),
  selectVoice: (selectedVoice) => set({ selectedVoice }),

  toggleStep: (voiceId, step) => {
    const { song, editing, engine } = get()
    const pattern = song.patterns.find((p) => p.id === editing)
    if (!pattern) return
    const next = replacePattern(song, cycleStep(pattern, voiceId, step))
    if (engine) engine.song = next
    set({ song: next, selectedVoice: voiceId })
  },

  clearPattern: () => {
    const { song, editing, engine } = get()
    const pattern = song.patterns.find((p) => p.id === editing)
    if (!pattern) return
    const next = replacePattern(song, { ...pattern, tracks: {} })
    if (engine) engine.song = next
    set({ song: next })
  },

  setParam: (voiceId, key, value) => {
    const { song, engine } = get()
    const params: VoiceParams = { ...song.kit.params[voiceId], [key]: value }
    const next: Song = {
      ...song,
      kit: { params: { ...song.kit.params, [voiceId]: params } },
    }
    if (engine) engine.song = next
    set({ song: next })
  },

  audition: (voiceId) => {
    get().init()
    get().engine?.audition(voiceId)
  },

  togglePerformance: () => set({ performance: !get().performance }),
}))
