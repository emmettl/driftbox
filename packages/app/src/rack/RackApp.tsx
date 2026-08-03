import {
  MIDI_INPUTS,
  MODULES,
  multisampleSlot,
  GROOVEBOX_PORTS,
  RACK_LIVE_INPUT,
  LanePlayer,
  Rack,
  compile,
  grooveboxSong,
  renderRetainedSongMix,
  patchCompatibility,
  packMultisampleZones,
  valueAt,
  renderPatch,
  type Patch,
} from '@driftbox/rack'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { BackPanel } from './BackPanel.js'
import { Chassis } from './Chassis.js'
import { sizeFor } from './faceplates/index.js'
import { layout } from './layout.js'
import { clearLive, publishLive } from './live.js'
import { moveTo, stepAt, STOPPED, type Playhead } from './playhead.js'
import { Palette } from './Palette.js'
import { Oscilloscope } from '../visual/Oscilloscope.js'
import { SCENES } from '../visual/scenes/index.js'
import { BREAKS, renderBreak } from './breaks.js'
import {
  DriftboxEngine,
  GROOVEBOX_SECTIONS,
  Kaoss,
  songBars,
  toWav,
} from '@driftbox/engine'
import { guessBars, normalise, sampleName, tempoForBars, toMono, waveformPeaks } from './sample.js'
import { suggestMultisampleZones } from './multisample.js'
import { KeyboardBank, midiTargets, openMidi, type MidiHandle } from '../midi.js'
import { publishMeters } from './meter.js'
import { ccValue, targets as ccTargets } from '../midi-cc.js'
import { PerformPad } from './PerformPad.js'
import { RackKeys } from './RackKeys.js'
import { Modulation } from './Modulation.js'
import { PatchBrowser } from './PatchBrowser.js'
import { patchShareLink, sequencerLink, storePatch } from './persistence.js'
import { openingPatch, useRack, type GrooveboxTapHit, type Opening } from './store.js'
import { buildLabel, buildTitle } from '../version.js'
import { routedGrooveboxSections } from './groovebox.js'
import { StemReviewTray } from '../ui/StemTray.js'
import {
  enumerateAudioInputs,
  openAudioInput,
  type AudioInputDevice,
  type AudioInputHandle,
} from './audio-input.js'
import { HelpDialog } from '../ui/HelpDialog.js'

type RackView = 'rack' | 'split' | 'pad'

// The rack, as a page.
//
// Its own entry point rather than a tab on the sequencer: `rack.html`, its own root, no shared store and
// no router. See the entry-point section of `docs/RACK.md` for why — the short version is that the rack
// turns around, and there is nothing in a step sequencer to hang that off.
//
// The flip is a CSS 3D rotation rather than three.js. The app already has `@react-three/fiber` for the
// visualiser, so WebGL was available and is the wrong tool here: rotating real DOM keeps every knob a
// real element with its own events, its focus ring and its ARIA role, which a canvas would have to
// reimplement badly. `preserve-3d` and `backface-visibility` are the whole mechanism.

/**
 * Keep every authored machine visible to the rack graph, diverting only patched ones.
 *
 * An unpatched source keeps the exact hosted mix #114 introduced and adds a silent rack
 * tap for its front-panel meter. The first cable removes that tap and diverts the whole
 * machine through the same worklet input; removing the last cable restores the original
 * route and tap without restarting the song.
 */
function routeGrooveboxSources(
  hosted: DriftboxEngine,
  live: Rack,
  patch: Patch,
): void {
  const routed = new Set(routedGrooveboxSections(patch))
  for (const section of GROOVEBOX_SECTIONS) {
    const ports = GROOVEBOX_PORTS[section]
    const input = live.input(ports.input)
    if (routed.has(section)) {
      hosted.tapSection(section, null)
      hosted.routeSection(section, input)
    } else {
      hosted.routeSection(section, null)
      hosted.tapSection(section, input)
    }
  }
}

export default function RackApp() {
  const patch = useRack((s) => s.patch)
  const revision = useRack((s) => s.revision)
  const flipped = useRack((s) => s.flipped)
  const flip = useRack((s) => s.flip)
  const undo = useRack((s) => s.undo)
  const redo = useRack((s) => s.redo)
  // The depth rather than the history, so this re-renders when undo becomes available and not on every
  // step taken while it already was. A selector returning an object would hand zustand a new snapshot
  // every call, which is the infinite-render trap the note further down this file records.
  const canUndo = useRack((s) => s.history.past.length > 0)
  const canRedo = useRack((s) => s.history.future.length > 0)
  const load = useRack((s) => s.load)
  const addModule = useRack((s) => s.addModule)
  const addChunk = useRack((s) => s.addChunk)
  const setNotes = useRack((s) => s.setNotes)
  const name = useRack((s) => s.name)
  const setName = useRack((s) => s.setName)
  const setMidi = useRack((s) => s.setMidi)
  const midiInputs = useRack((s) => s.midiInputs)
  const setVoices = useRack((s) => s.setVoices)
  const voices = useRack((s) => s.patch.voices ?? 1)
  const hasMidi = useRack((s) => s.patch.modules.some((m) => m.type === 'midi'))
  const setTempo = useRack((s) => s.setTempo)
  const setBreak = useRack((s) => s.setBreak)
  const setVisual = useRack((s) => s.setVisual)
  const playing = useRack((s) => s.running)
  const setRunning = useRack((s) => s.setRunning)
  const automating = useRack((s) => s.automating)
  const setAutomating = useRack((s) => s.setAutomating)
  const ensureSampler = useRack((s) => s.ensureSampler)
  const compatibility = useMemo(() => patchCompatibility(patch), [patch])
  const retainedSong = useMemo(() => grooveboxSong(patch), [patch])
  const performanceScene = retainedSong?.visual ?? patch.visual ?? SCENES[0].id
  // Until hosted song playback lands, a compatible rack still follows the retained
  // song's tempo. Writing a different tempo is an explicit rack override and therefore
  // changes the compatibility state to rack-extended.
  const tempo = patch.tempo ?? retainedSong?.bpm ?? 120
  const shuffle = retainedSong?.swing ?? 0

  const rack = useRef<Rack | null>(null)
  /** Where the rack's transport is, in musical time. See `playhead.ts`. */
  const playhead = useRef<Playhead>(STOPPED)
  /** The retained song playing beside the rack graph, through the same final performance bus. */
  const groovebox = useRef<DriftboxEngine | null>(null)
  /** Exact envelope currently hosted, so rack-only edits do not rebuild the song engine. */
  const hostedGroovebox = useRef<string | undefined>(undefined)
  /** Detach launch observations before replacing the hosted engine. */
  const grooveboxLaunchObserver = useRef<(() => void) | null>(null)
  const bindGrooveboxPerformance = useCallback((hosted: DriftboxEngine | null) => {
    grooveboxLaunchObserver.current?.()
    grooveboxLaunchObserver.current = null

    const state = useRack.getState()
    state.clearGrooveboxLaunches()
    state.setGrooveboxLoop(null)
    state.setGrooveboxAutomationPosition(
      hosted ? () => (hosted.running ? hosted.position : null) : null,
    )
    state.setGrooveboxLauncher(
      hosted
        ? (section, patternId, quantization) =>
            hosted.queueClip(section, patternId, quantization)
        : null,
    )
    state.setGrooveboxTransport(
      hosted
        ? {
            startAt: (bar) => {
              const live = rack.current
              if (!live) return false
              const total = Math.max(1, songBars(hosted.song))
              const start = Math.max(0, Math.min(total - 1, Math.floor(bar)))
              const currentPatch = useRack.getState().patch
              live.setTransport(
                currentPatch.tempo ?? grooveboxSong(currentPatch)?.bpm ?? 120,
                true,
                grooveboxSong(currentPatch)?.swing ?? 0,
              )
              useRack.getState().setRunning(true)
              void hosted.startAt(start)
              return true
            },
            setLoop: (start, bars) => {
              const total = Math.max(1, songBars(hosted.song))
              const loopStart = Math.max(0, Math.min(total - 1, Math.floor(start)))
              const loopBars = Math.max(
                1,
                Math.min(total - loopStart, Math.floor(bars)),
              )
              hosted.setLoop(loopStart, loopBars)
              useRack.getState().setGrooveboxLoop({ start: loopStart, bars: loopBars })
              return true
            },
            clearLoop: () => {
              hosted.clearLoop()
              useRack.getState().setGrooveboxLoop(null)
            },
          }
        : null,
    )
    if (hosted) {
      grooveboxLaunchObserver.current = hosted.onClipLaunch((event) =>
        useRack.getState().setGrooveboxLaunch(event),
      )
    }
  }, [])
  /**
   * The rack's own analyser.
   *
   * State rather than a ref, because the scope has to re-render once it exists. It is the sequencer's
   * `Oscilloscope` component reading it — the same trace, the same phosphor persistence — which took
   * removing that component's dependency on the sequencer's store. It is genuinely diagnostic here rather
   * than decorative: a VCA left shut reads as a flat line, and a patch clipping into the Out reads as a
   * flattened top, and both are otherwise invisible.
   */
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  /** The performance filter. A ref because the audio graph owns it; the boolean is only so React re-renders
   *  the pad once there is something for it to move. */
  const kaoss = useRef<Kaoss | null>(null)
  const [hasKaoss, setHasKaoss] = useState(false)
  /**
   * Three views of one instrument, rather than a modal performance page.
   *
   * `split` is the useful middle ground: the rack moves aside but stays live while the performance pad
   * occupies the neighbouring bay. One state machine also makes the header button's Rack → Split → Pad
   * cycle explicit instead of coordinating two booleans that could describe an impossible view.
   */
  const [rackView, setRackView] = useState<RackView>('rack')
  const performing = rackView !== 'rack'
  const performanceSpace = useRef<HTMLDivElement>(null)
  const [keyboardOpen, setKeyboardOpen] = useState(true)
  const [started, setStarted] = useState(false)
  const [failed, setFailed] = useState(false)
  const [shared, setShared] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [reviewingStems, setReviewingStems] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    const openHelp = (event: KeyboardEvent) => {
      if (event.key !== '?') return
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      event.preventDefault()
      setHelpOpen(true)
    }
    window.addEventListener('keydown', openHelp)
    return () => window.removeEventListener('keydown', openHelp)
  }, [])
  /**
   * Move between the three arrangements with one shared-element transition when the browser can do it.
   *
   * Split → Pad is the important case: the browser snapshots the *same* pad before and after the state
   * change, so its real 480px square grows into the full performance surface instead of one pad fading out
   * while another fades in. Pad → Rack has no shared surface, but the named old pad and new rack let CSS
   * choreograph a hand-off. Rack → Split keeps its existing lightweight CSS entrance.
   */
  const cycleRackView = useCallback(() => {
    const next: RackView = rackView === 'rack' ? 'split' : rackView === 'split' ? 'pad' : 'rack'
    const update = () => {
      setRackView(next)
      setAdding(false)
      setBrowsing(false)
    }

    if (
      rackView === 'rack' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      !document.startViewTransition
    ) {
      update()
      return
    }

    const motion = `${rackView}-${next}`
    const root = document.documentElement
    root.dataset.rackViewTransition = motion
    const transition = document.startViewTransition(() => flushSync(update))
    void transition.finished
      .finally(() => {
        if (root.dataset.rackViewTransition === motion) delete root.dataset.rackViewTransition
      })
      .catch(() => {})
  }, [rackView])

  /* The split grid is horizontally scrollable on narrow screens. Its DOM node survives all three views,
     so a trip through full-pad mode otherwise remembers the pad-side scroll offset and reopens split with
     the rack entirely off-screen. A layout effect restores the rack bay before the new frame is painted. */
  useLayoutEffect(() => {
    if (rackView === 'split' && performanceSpace.current) performanceSpace.current.scrollLeft = 0
  }, [rackView])
  /** Which break is loaded, by id as well as name — the id so an export can render it again.
   *  Keeping the audio itself would mean holding about 700kB for the life of the page, and `setData`
   *  transfers the array away anyway, so there is nothing left on this side to keep. */
  const [loadedBreak, setLoadedBreak] = useState<{ id: string; name: string } | null>(null)
  /**
   * The break this patch is written around, whether or not one has been pushed to the audio thread yet.
   *
   * Separate from `loadedBreak` on purpose, and the export is why. Exporting before pressing play used to
   * produce a file with the bass and no drums: `loadedBreak` only becomes true once `loadBreak` has run, and
   * the render does not need a live rack at all. Showing a break as loaded when it is not would be a lie;
   * exporting the wrong file silently is worse. So there are two facts and they are both recorded.
   */
  const [intendedBreak, setIntendedBreak] = useState<string | null>(null)
  const [exporting, setExporting] = useState<'patch' | 'song' | null>(null)
  /** Selected as the object, filtered outside. A selector that builds a new array returns a different
   *  reference every call and re-renders for ever — this app has had that bug once already. */
  const samples = useRack((s) => s.samples)
  const multisamples = useRack((s) => s.multisamples)
  /**
   * What the AudioContext says about itself.
   *
   * Worth knowing rather than assuming, because a browser suspends a context on its own — a background tab, an
   * interruption on iOS — and then the transport is running as far as this app is concerned while nothing is
   * coming out. Event-driven off `statechange` rather than polled.
   */
  const [audioState, setAudioState] = useState<AudioContextState | 'none'>('none')
  const midi = useRef<MidiHandle | null>(null)
  const [midiState, setMidiState] = useState<'off' | 'on' | 'unavailable'>('off')
  const hasAudioInput = patch.modules.some((module) => module.type === 'audio-input')
  const audioInput = useRef<AudioInputHandle | null>(null)
  const [audioInputs, setAudioInputs] = useState<AudioInputDevice[]>([])
  const [selectedAudioInput, setSelectedAudioInput] = useState('')
  const [audioInputState, setAudioInputState] = useState<
    'off' | 'opening' | 'on' | 'denied' | 'unavailable'
  >('off')
  const [audioInputError, setAudioInputError] = useState<string | null>(null)

  const geometry = useMemo(() => layout(patch.modules, sizeFor(MODULES)), [patch.modules])

  /**
   * Send an incoming note to every MIDI module listening on that channel.
   *
   * Straight to `rack.setParam` and **never through the store's patch**. A note somebody played is
   * performance, not document — routing it through the patch would autosave the last key anybody pressed
   * into the file, and every note would also bump the revision and recompile the graph. The store gets a
   * copy of the note only so the faceplate can say whether a keyboard is connected.
   */
  const sendMidi = useCallback(
    (
      channel: number,
      values: Partial<Record<(typeof MIDI_INPUTS)[number], number>>,
      voice?: number,
    ) => {
      const live = rack.current
      if (!live) return
      // The decision about *which* modules hear this is `midiTargets`, which is pure and tested — Chrome
      // refuses Web MIDI under automation, so a rule left in here could not be verified at all.
      for (const id of midiTargets(useRack.getState().patch.modules, channel)) {
        // `voice` undefined means every voice, which is right for the mod wheel — one wheel, all the notes.
        // A note names its voice, which is how one MIDI module holds a chord.
        for (const [param, value] of Object.entries(values)) live.setParam(id, param, value, voice)
      }
    },
    [],
  )

  /**
   * Render a break and hand it to every sampler in the patch.
   *
   * A copy per sampler, because `setData` **transfers** the buffer — after the first send the array is empty on
   * this side, so loading one break into two samplers would give the second one nothing. That is the cost of not
   * copying on the audio thread's doorstep, and it is worth it; it just has to be known about.
   */
  /** `start` needs `loadBreak`, and `loadBreak` is defined here rather than above it. A ref bridges the two.
   *  Declared before the assignment below and not next to `start`, because `loadBreakRef.current = loadBreak`
   *  runs during render — putting the `const` further down the component was a temporal-dead-zone crash that
   *  took the whole page out, and nothing but loading the page would have found it. */
  const loadBreakRef = useRef<(id: string) => Promise<void>>(async () => {})
  const stopSamplePreviewRef = useRef<() => void>(() => {})

  const loadBreak = useCallback(
    async (id: string) => {
      stopSamplePreviewRef.current()
      const entry = BREAKS.find((candidate) => candidate.id === id)
      if (!entry) return
      // Recorded before the live-rack check, not after. This used to return early when audio had not started,
      // which meant choosing a break-backed patch from the picker and exporting it produced a file with the
      // bass and no drums — the same early-return-before-recording-the-fact shape as the bug above.
      setIntendedBreak(entry.id)
      setBreak(entry.id)

      const live = rack.current
      if (!live) return

      // **If there is nowhere to put it, make somewhere.** Clicking a break used to do nothing at all when the
      // patch had no Sampler — there was a hint saying to add one, and the button stayed enabled and silently
      // no-opped. For an instrument whose whole aim is being fun in four seconds, clicking a break has to produce
      // a break; being told to go and assemble three modules first is the opposite of that.
      ensureSampler()
      // The patch it may just have changed has to reach the audio thread before the data does, or the data is for
      // a module the Graph has not built yet.
      live.patch = useRack.getState().patch

      const rendered = await renderBreak(entry, { sampleRate: live.output?.context.sampleRate })
      const samplers = useRack.getState().patch.modules.filter((m) => m.type === 'sampler')
      // A copy per sampler, because `setData` transfers: after the first send the array is empty on this side.
      for (const module of samplers) live.setData(module.id, 'sample', rendered.slice())
      setLoadedBreak({ id: entry.id, name: entry.name })
      for (const module of samplers) {
        // Retained once for auditioning and export. Several Samplers may safely share this immutable array;
        // only the copies transferred to the worklet are detached.
        sampleAudio.current.set(module.id, rendered)
        useRack.getState().setSample(module.id, {
          name: entry.name,
          bars: 1,
          seconds: (4 * 60) / entry.tempo,
          peaks: waveformPeaks(rendered),
          source: 'break',
        })
      }

      // A break is rendered at its own tempo and only slices cleanly at that tempo, so adopting it means adopting
      // the tempo too. Letting the chop drift silently would be the worse outcome.
      if ((useRack.getState().patch.tempo ?? 120) !== entry.tempo) setTempo(entry.tempo)
      // And it should be playing. Loading a break and hearing nothing is the same failure as the stop button.
      setRunning(true)
    },
    [ensureSampler, setBreak, setTempo, setRunning],
  )

  loadBreakRef.current = loadBreak

  /**
   * One allocator for every keyboard, on screen or plugged in.
   *
   * Two banks would fight over the voices: each would believe it owned all of them, so an on-screen note
   * could be silently stolen by one from hardware and a release would hand back a voice the other still
   * thought it held. Sharing also means the on-screen keys light up for notes arriving from a controller,
   * which is the cheapest possible way to see that a controller is working.
   */
  const bank = useRef(new KeyboardBank())
  /** Notes claimed by the Groovebox tap recorder instead of the generic rack MIDI path. */
  const grooveboxTaps = useRef(new Map<number, GrooveboxTapHit>())
  /** Which notes are sounding, for lighting the keys. Session state; it never goes near the patch. */
  const [sounding, setSounding] = useState<number[]>([])

  /** The one path a note takes to the audio thread, whichever keyboard played it. */
  const playVoice = useCallback(
    (state: { voice: number; note: number; gate: 0 | 1; velocity: number }, channel = 1) => {
      const heldTap = grooveboxTaps.current.get(state.note)
      if (state.gate === 0 && heldTap) {
        grooveboxTaps.current.delete(state.note)
        if (heldTap.section === '303.a' || heldTap.section === '303.b') {
          groovebox.current?.bassNoteOff(heldTap.section)
        }
        setSounding(bank.current.sounding())
        return
      }

      if (state.gate === 1) {
        // A monophonic allocator can emit a second gate-on when it falls back to a key that is still
        // held. It should sound again, but it is not another tap and must not overwrite another step.
        const tap = heldTap ?? useRack.getState().recordGrooveboxTap(state.note, state.velocity)
        if (tap) {
          const legato = [...grooveboxTaps.current.values()].some(
            (held) => held.section === tap.section,
          )
          grooveboxTaps.current.set(state.note, tap)
          if (tap.section === '303.a' || tap.section === '303.b') {
            groovebox.current?.bassNoteOn(tap.section, tap.semitone, tap.accent, legato)
          } else {
            groovebox.current?.audition(tap.voiceId, tap.accent ? 1 : 0.55)
          }
          setMidi(state.note)
          setSounding(bank.current.sounding())
          return
        }
      }

      sendMidi(channel, { note: state.note, gate: state.gate, velocity: state.velocity }, state.voice)
      // Only the note that just sounded reaches the faceplate. A gate-off does not clear it, because on a
      // chord the last thing released is not interesting and blanking on it would flicker.
      if (state.gate === 1) setMidi(state.note)
      setSounding(bank.current.sounding())
    },
    [sendMidi, setMidi],
  )

  const keysDown = useCallback(
    (note: number, velocity: number) => {
      for (const state of bank.current.for(1).down(note, velocity)) playVoice(state)
    },
    [playVoice],
  )
  const keysUp = useCallback(
    (note: number) => {
      for (const state of bank.current.for(1).up(note)) playVoice(state)
    },
    [playVoice],
  )
  const keysAllOff = useCallback(() => {
    for (const { state, channel } of bank.current.allOff()) playVoice(state, channel)
  }, [playVoice])

  /**
   * A controller moved. Either teach it a parameter, or move the ones it already drives.
   *
   * **Through the store, not straight to the audio thread** — and that is the opposite of what a *note*
   * does two functions up. The difference is real: a note somebody played is performance and must never
   * reach the patch, whereas a controller turning a Combinator rotary is the same act as turning that
   * rotary with a mouse. It has to move the knob on screen, run the Combinator's routing so everything it
   * drives moves with it, save, and travel in a link. `setParam` already does all of that; going direct
   * would give a rotary that silently did nothing but change the sound.
   */
  const onControl = useCallback((cc: number, raw: number, channel: number) => {
    const state = useRack.getState()
    // Learning wins. While a parameter is armed, the next controller message teaches it rather than moving
    // whatever else that controller happens to be bound to — otherwise arming a knob you had already
    // mapped would fight itself.
    if (state.ccLearning) {
      state.finishCcLearn(cc)
      return
    }
    for (const binding of ccTargets(state.ccBindings, cc, channel)) {
      const module = state.patch.modules.find((m) => m.id === binding.module)
      if (!module) continue
      const param = MODULES[module.type]?.params.find((p) => p.id === binding.param)
      // A binding whose module has been deleted, or whose param this build does not have. Left in storage
      // rather than pruned: the patch it was taught against may well be opened again.
      if (!param || param.hidden) continue
      state.setParam(binding.module, binding.param, ccValue(raw, param))
    }
  }, [])

  async function toggleMidi() {
    if (midi.current) {
      midi.current.close()
      midi.current = null
      setMidiState('off')
      setMidi(null, [])
      return
    }
    const handle = await openMidi(
      {
        onVoice: (state, channel) => playVoice(state, channel),
        onMod: (value, channel) => sendMidi(channel, { mod: value }),
        onControl,
        onInputs: (inputs) => setMidi(null, inputs),
      },
      bank.current,
    )
    if (!handle) {
      // Web MIDI is Chromium-only, so this is the common case rather than the exceptional one. Absence has
      // to read as absence — the same standard `loadRack` holds itself to when there is no AudioWorklet.
      setMidiState('unavailable')
      return
    }
    midi.current = handle
    setMidiState('on')
    setMidi(null, handle.inputs)
  }

  /**
   * Whatever we were opened with: a shared link, the last session, or the starter patch.
   *
   * The preset is kept so that pressing play can render the break it was written around. Only a *fresh*
   * arrival has one — a shared link or a saved session is somebody's work, and swapping it for a demo
   * because that makes a better first impression would be the worst thing this page could do.
   */
  const opening = useRef<Opening | null>(null)
  useEffect(() => {
    void openingPatch().then((result) => {
      opening.current = result
      load(result.patch)
      // A shipped patch is a named piece of work, not an anonymous graph. This matters most in Perform
      // mode, where the rack is hidden: before this, the hero demo's only visible identity became the
      // sample it happened to load, which made a complete song read like a break preset.
      if (result.preset) setName(result.preset.name)
      // Recorded before anything is played, so an export straight off the page still has its drums.
      const wanted = result.patch.break ?? result.preset?.needsBreak
      if (wanted) setIntendedBreak(wanted)
    })
  }, [load, setName])

  /**
   * The audio behind every loaded sample, by module id.
   *
   * A ref rather than store state: it is megabytes, the store is compared on every render, and keeping it
   * there would put it one careless `encodePatch` away from a shared link. The store holds only what a
   * faceplate needs to *say* — see `SampleInfo`.
   *
   * Kept at all because somebody's own file cannot be re-made: a shipped break can be rendered again from
   * its id, and a loaded one is gone the moment `setData` transfers it to the audio thread. The export
   * needs it back.
   */
  const sampleAudio = useRef(new Map<string, Float32Array>())
  /** Multisampler PCM, retained for export just like `sampleAudio`, ordered to match `sampleN` slots. */
  const multisampleAudio = useRef(new Map<string, readonly Float32Array[]>())
  /** One raw-sample audition at a time, independent of the rack transport and patch cables. */
  const samplePreviewContext = useRef<AudioContext | null>(null)
  const samplePreviewSource = useRef<AudioBufferSourceNode | null>(null)
  const samplePreviewTicket = useRef(0)

  const stopSamplePreview = useCallback(() => {
    samplePreviewTicket.current++
    const source = samplePreviewSource.current
    samplePreviewSource.current = null
    source?.disconnect()
    try {
      source?.stop()
    } catch {
      // An already-ended source is stopped in every meaningful sense.
    }
    useRack.getState().setPreviewingSample(null)
  }, [])
  stopSamplePreviewRef.current = stopSamplePreview

  const previewSample = useCallback(async (moduleId: string) => {
    if (useRack.getState().previewingSample === moduleId) {
      stopSamplePreview()
      return
    }

    stopSamplePreview()
    const samples = sampleAudio.current.get(moduleId)
    const info = useRack.getState().samples[moduleId]
    if (!samples || !info || !(info.seconds > 0)) return

    // Audition the source, not the source layered over the running rack. The rack context suspends when its
    // transport stops; this preview owns a separate context so it remains audible.
    if (useRack.getState().running) useRack.getState().setRunning(false)

    const ticket = samplePreviewTicket.current
    const context = samplePreviewContext.current ?? new AudioContext()
    samplePreviewContext.current = context
    if (context.state === 'suspended') await context.resume()
    if (ticket !== samplePreviewTicket.current) return

    // Recover the decode rate from the retained frame count and exact duration. The preview context resamples
    // it to the output device; forcing its own rate here would change the length and pitch.
    const sampleRate = Math.max(3_000, Math.min(192_000, Math.round(samples.length / info.seconds)))
    const buffer = context.createBuffer(1, samples.length, sampleRate)
    buffer.getChannelData(0).set(samples)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    source.onended = () => {
      if (samplePreviewSource.current !== source) return
      samplePreviewSource.current = null
      source.disconnect()
      useRack.getState().setPreviewingSample(null)
    }
    samplePreviewSource.current = source
    useRack.getState().setPreviewingSample(moduleId)
    source.start()
  }, [stopSamplePreview])

  useEffect(() => {
    useRack.getState().setSamplePreviewer(previewSample)
    return () => {
      useRack.getState().setSamplePreviewer(null)
      stopSamplePreview()
      const context = samplePreviewContext.current
      samplePreviewContext.current = null
      if (context && context.state !== 'closed') void context.close()
    }
  }, [previewSample, stopSamplePreview])

  /**
   * Load an audio file into one Sampler.
   *
   * Decoded through a throwaway `OfflineAudioContext`, so this works before audio has ever been started —
   * the same standard the export holds itself to.
   *
   * The tempo is **derived from the file** rather than asked for. The Sampler slices by equal division, so
   * a chop only lands on the beat if the buffer is a whole number of bars and the patch runs at the tempo
   * that makes it so; see the note at the top of `sample.ts`.
   */
  const loadSampleInto = useCallback(async (moduleId: string, file: File) => {
    stopSamplePreview()
    const bytes = await file.arrayBuffer()
    // 1 frame is the smallest legal length; nothing is rendered through it, it only decodes.
    const decoder = new OfflineAudioContext(1, 1, 44100)
    const decoded = await decoder.decodeAudioData(bytes)

    const samples = normalise(toMono(decoded))
    const seconds = decoded.length / decoded.sampleRate
    const bars = guessBars(seconds, useRack.getState().patch.tempo ?? 120)

    sampleAudio.current.set(moduleId, samples)
    useRack.getState().setSample(moduleId, {
      name: sampleName(file.name),
      bars,
      seconds,
      peaks: waveformPeaks(samples),
      source: 'file',
    })

    // A copy, because `setData` transfers and the export needs the original back.
    rack.current?.setData(moduleId, 'sample', samples.slice())
    const tempo = tempoForBars(seconds, bars)
    if (tempo > 0) setTempo(Math.round(tempo * 100) / 100)
    setRunning(true)
  }, [setTempo, setRunning, stopSamplePreview])

  useEffect(() => {
    useRack.getState().setSampleLoader(loadSampleInto)
  }, [loadSampleInto])

  /** Decode a batch, infer its root/range/layer map, and push every recording into one Multisampler. */
  const loadMultisamplesInto = useCallback(async (moduleId: string, files: readonly File[]) => {
    if (files.length === 0) return
    stopSamplePreview()
    const decoded = await Promise.all(
      files.map(async (file) => {
        const bytes = await file.arrayBuffer()
        const decoder = new OfflineAudioContext(1, 1, 44100)
        const audio = await decoder.decodeAudioData(bytes)
        const samples = normalise(toMono(audio))
        return {
          samples,
          info: {
            name: sampleName(file.name),
            seconds: audio.length / audio.sampleRate,
            sampleRate: audio.sampleRate,
            peaks: waveformPeaks(samples, 48),
          },
        }
      }),
    )

    const zones = suggestMultisampleZones(
      decoded.map(({ info }) => ({ name: info.name, sampleRate: info.sampleRate })),
    )
    multisampleAudio.current.set(moduleId, decoded.map(({ samples }) => samples))
    useRack.getState().setMultisamples(moduleId, decoded.map(({ info }) => info))
    // Zone metadata is document state; PCM is deliberately session-only. The store subscription pushes
    // `zones`, while these direct sends transfer copies of the retained audio into the live graph.
    useRack.getState().setData(moduleId, 'zones', packMultisampleZones(zones))
    for (let index = 0; index < decoded.length; index++) {
      rack.current?.setData(moduleId, multisampleSlot(index), decoded[index].samples.slice())
    }
    setRunning(true)
  }, [setRunning, stopSamplePreview])

  useEffect(() => {
    useRack.getState().setMultisampleLoader(loadMultisamplesInto)
  }, [loadMultisamplesInto])

  /**
   * A library load can replace a hosted song with another song or a native patch after
   * audio has started. Rebuild only when the retained envelope changes; adding a cable
   * to the surrounding rack must not restart the groovebox transport.
   */
  useEffect(() => {
    const live = rack.current
    const pad = kaoss.current
    if (!live || !pad || hostedGroovebox.current === patch.groovebox) return

    const current = groovebox.current
    hostedGroovebox.current = patch.groovebox

    // Pattern edits replace the immutable retained envelope, but they do not replace
    // the instrument. The sequencer uses this same live-song handoff: the scheduler
    // reads the new pattern on the next step, preserving the playhead, ringing voices,
    // source routes and meter taps.
    if (current && retainedSong) {
      current.song = retainedSong
      current.bpm = patch.tempo ?? retainedSong.bpm
      current.syncFx()
      return
    }

    bindGrooveboxPerformance(null)
    current?.dispose()
    groovebox.current = null
    if (!retainedSong) return

    const hosted = new DriftboxEngine(retainedSong, {
      context: live.output?.context as AudioContext,
      destination: pad.input,
    })
    groovebox.current = hosted
    bindGrooveboxPerformance(hosted)
    routeGrooveboxSources(hosted, live, useRack.getState().patch)
    if (playing) void hosted.start()
  }, [bindGrooveboxPerformance, patch.groovebox, patch.tempo, playing, retainedSong])

  /**
   * Render the patch to a WAV and hand it over.
   *
   * Offline rather than a recording of what is playing — see the note at the top of `render.ts`. The break
   * is rendered again rather than kept: `setData` transfers the array to the audio thread, so there is
   * nothing on this side to reuse, and holding a copy would be 700kB for the life of the page.
   *
   * It does not need the live rack at all, which is the useful part: exporting works before audio has ever
   * been started, and a patch shared as a link can be turned into a file without pressing play.
   */
  const exportPatch = useCallback(async () => {
    const patch = useRack.getState().patch
    const breakId = patch.break ?? intendedBreak
    const entry = breakId ? BREAKS.find((b) => b.id === breakId) : undefined

    const data: Record<string, Record<string, Float32Array>> = {}
    // A loaded file wins over a shipped break, per sampler. Rendering the break over the top would silently
    // export something other than what is playing.
    for (const [moduleId, samples] of sampleAudio.current) {
      data[moduleId] = { sample: samples.slice() }
    }
    for (const [moduleId, samples] of multisampleAudio.current) {
      data[moduleId] = Object.fromEntries(
        samples.map((sample, index) => [multisampleSlot(index), sample.slice()]),
      )
    }
    if (entry) {
      const rendered = await renderBreak(entry, { sampleRate: 44100 })
      for (const module of patch.modules) {
        if (module.type !== 'sampler' || data[module.id]) continue
        // A copy per sampler, for the same reason `loadBreak` makes one: `setData` transfers.
        data[module.id] = { sample: rendered.slice() }
      }
    }

    const buffer = await renderPatch(patch, { registry: MODULES, bars: 8, sampleRate: 44100, data })
    const url = URL.createObjectURL(toWav(buffer))
    const link = document.createElement('a')
    link.href = url
    link.download = `${(useRack.getState().name ?? 'driftbox-rack').replace(/[^\w-]+/g, '-')}.wav`
    link.click()
    // Revoked on the next turn of the event loop rather than immediately: revoking before the click has
    // been handled cancels the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }, [intendedBreak])

  /**
   * Export the retained authored document without flattening rack-only changes into it.
   *
   * Rack mode remains a strict superset of the sequencer: opening a song here must not
   * take its original mastered WAV away. This is deliberately separate from Patch WAV;
   * the latter renders rack modules and cables, while this recalls the intact Groovebox
   * song that can travel back to the sequencer.
   */
  const exportGrooveboxMix = useCallback(async () => {
    if (!retainedSong) return
    const buffer = await renderRetainedSongMix(useRack.getState().patch)
    if (!buffer) return
    const url = URL.createObjectURL(toWav(buffer))
    const link = document.createElement('a')
    link.href = url
    const documentName = (useRack.getState().name ?? 'driftbox-song').replace(/[^\w-]+/g, '-')
    link.download = `${documentName}-mix.wav`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }, [retainedSong])

  /**
   * Keep the allocator agreeing with the graph about how many voices exist.
   *
   * Was done once, when Web MIDI was opened. That was already the wrong place — changing the voice count
   * afterwards left the keyboards allocating across a number the audio thread no longer had, so a note
   * could land on a voice that did not exist — and it is doubly wrong now the on-screen keys can play
   * without Web MIDI ever being opened at all.
   */
  useEffect(() => {
    for (const { state, channel } of bank.current.setVoices(patch.voices ?? 1)) {
      playVoice(state, channel)
    }
  }, [patch.voices, playVoice])

  // Tab flips the rack, the way it does in Reason. Kept off inputs so a rename field is still usable.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      event.preventDefault()
      flip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flip])

  /**
   * Undo and redo, on the keys every other program puts them on.
   *
   * Both accents are accepted — Cmd on a Mac, Ctrl elsewhere, plus Ctrl+Y for redo, which is what
   * Windows habits reach for. Kept off inputs so a rename or a tempo field keeps the browser's own undo,
   * which is a different history about a different thing and would be very confusing to hijack.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return
      const key = event.key.toLowerCase()
      const back = key === 'z' && !event.shiftKey
      const forward = (key === 'z' && event.shiftKey) || key === 'y'
      if (!back && !forward) return
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      event.preventDefault()
      if (back) undo()
      else redo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  /**
   * Push the patch at the audio thread when the GRAPH changes, and never when a knob moves.
   *
   * `revision` and not `patch`. A knob turn produces a new patch object — it has to, so React re-renders
   * — but recompiling on it would rebuild every processor sixty times a second while somebody drags,
   * which resets each oscillator's phase and each filter's history. That is a continuous crackle. The
   * knob's own value reaches the audio thread through `rack.setParam`, which is a message and a one-block
   * ramp. See the note at the top of `store.ts`.
   */
  useEffect(() => {
    const live = rack.current
    const current = useRack.getState().patch
    if (live) {
      live.patch = current
      const hosted = groovebox.current
      if (hosted) routeGrooveboxSources(hosted, live, current)
    }
    // Compiled for diagnostics whether or not audio is running. The Rack would produce the same notes,
    // but only once it exists — and a feedback cable has to be drawn as feedback from the moment it is
    // patched, not from the moment somebody presses Start. Compiling is pure and cheap; it is the same
    // function the audio thread's plan comes from, so the two cannot disagree.
    setNotes(compile(current, MODULES).notes)
  }, [revision, setNotes])

  const closeAudioInput = useCallback(() => {
    audioInput.current?.close()
    audioInput.current = null
    setAudioInputState('off')
    setAudioInputError(null)
  }, [])

  /**
   * Permission and hardware selection stay on the host side. A patch records that it
   * wants an Audio Input module, never the device id of one particular computer.
   */
  const connectAudioInput = useCallback(async (deviceId?: string) => {
    const live = rack.current
    const context = live?.output?.context as AudioContext | undefined
    const destination = live?.input(RACK_LIVE_INPUT)
    if (!context || !destination) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setAudioInputState('unavailable')
      setAudioInputError('Audio capture is unavailable here. Use a secure HTTPS or localhost page.')
      return
    }

    const previous = audioInput.current
    setAudioInputState('opening')
    setAudioInputError(null)
    try {
      // Open first, close second: a rejected device switch leaves the sounding input alone.
      const next = await openAudioInput(context, destination, deviceId)
      previous?.close()
      audioInput.current = next
      setSelectedAudioInput(next.deviceId)
      setAudioInputState('on')
      if (context.state === 'suspended') await context.resume()
      try {
        setAudioInputs(await enumerateAudioInputs())
      } catch {
        // Capture works without enumeration; only the picker loses its other choices.
        setAudioInputs([{ id: next.deviceId, label: next.label }])
      }
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      setAudioInputState(previous ? 'on' : name === 'NotSupportedError' ? 'unavailable' : 'denied')
      setAudioInputError(
        name === 'NotAllowedError'
          ? 'Audio-input permission was denied.'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'That audio input is no longer available.'
            : 'The browser could not open that audio input.',
      )
    }
  }, [])

  // Removing the last source module releases the microphone/interface immediately.
  useEffect(() => {
    if (!hasAudioInput) closeAudioInput()
  }, [closeAudioInput, hasAudioInput])

  // Keep the selector current while interfaces are plugged in or removed.
  useEffect(() => {
    if (audioInputState !== 'on' || !navigator.mediaDevices?.addEventListener) return
    const refresh = () => {
      void enumerateAudioInputs()
        .then(setAudioInputs)
        .catch(() => {})
    }
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [audioInputState])

  const start = useCallback(async () => {
    if (rack.current) return
    // A pedal chain is played through, so ask the browser to favour response time over
    // a deeper power-saving buffer. It is a hint, not a latency guarantee.
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    // Every module, because this is the editor: a rack you can patch anything into cannot ship a registry
    // chosen ahead of time. An embedding host with a fixed patch is the case that passes fewer — see `Rack`.
    const live = new Rack(ctx, MODULES)
    if (!(await live.start())) {
      // No worklet, no rack — unlike the engine's ladder there is nothing to fall back to, and saying
      // so is better than looking broken.
      setFailed(true)
      return
    }
    live.onMeters(publishMeters)
    ctx.onstatechange = () => setAudioState(ctx.state)
    setAudioState(ctx.state)

    // The performance filter, as an insert across everything the rack makes. After the rack's output means
    // after its master limiter, which is the same order the engine uses and for the same reason: the
    // limiter should not be reacting to a signal the filter is about to throw away.
    const pad = new Kaoss(ctx)
    live.output?.connect(pad.input)
    kaoss.current = pad
    setHasKaoss(true)

    // Host the intact authored song with its own engine rather than exploding it into
    // anonymous rack primitives. Both engines enter the same pad, analyser and destination,
    // so performance controls and visuals see one combined output.
    const currentPatch = useRack.getState().patch
    const song = grooveboxSong(currentPatch)
    const hosted = song
      ? new DriftboxEngine(song, { context: ctx, destination: pad.input })
      : null
    groovebox.current = hosted
    hostedGroovebox.current = currentPatch.groovebox
    bindGrooveboxPerformance(hosted)

    const scope = ctx.createAnalyser()
    scope.fftSize = 2048
    scope.smoothingTimeConstant = 0.75
    // The scope watches the filtered signal, so sweeping the pad shows on it. Watching the pre-filter output
    // would have drawn a waveform nobody could hear.
    pad.output.connect(scope)
    pad.output.connect(ctx.destination)
    setAnalyser(scope)

    live.patch = useRack.getState().patch
    rack.current = live
    // Files may be decoded before the first Start gesture. Their PCM is retained specifically because
    // `setData` transfers buffers, so hydrate the new audio thread now; patch metadata was already seeded by
    // `live.patch`. This also closes the same pre-start hole for the original break Sampler.
    for (const [moduleId, samples] of sampleAudio.current) {
      live.setData(moduleId, 'sample', samples.slice())
    }
    for (const [moduleId, samples] of multisampleAudio.current) {
      for (let index = 0; index < samples.length; index++) {
        live.setData(moduleId, multisampleSlot(index), samples[index].slice())
      }
    }
    if (hosted) routeGrooveboxSources(hosted, live, currentPatch)
    // A guitar preset should become an instrument from the same gesture that starts
    // audio. The permission prompt is still the browser's, and a refusal leaves the rack
    // running with a visible Enable input control.
    if (currentPatch.modules.some((module) => module.type === 'audio-input')) {
      void connectAudioInput()
    }
    // The gesture that starts audio is also the gesture that starts the music. Anything else means arriving,
    // pressing a button, and getting silence — which is the "instant DJ" problem in `docs/DNB.md`.
    live.setTransport(currentPatch.tempo ?? song?.bpm ?? 120, true, song?.swing ?? 0)
    setRunning(true)
    setStarted(true)
    if (hosted) await hosted.start()

    // The reward for the gesture, and `docs/DNB.md` calls this the most important thing in it: a beat, not a
    // bleep. The opening patch is a chopped break for a first-time visitor, and a break is silent until one
    // has been rendered into it — so the gesture that starts audio is also the one that fills the Sampler.
    const wanted = useRack.getState().patch.break ?? opening.current?.preset?.needsBreak
    if (wanted) void loadBreakRef.current(wanted)
  }, [bindGrooveboxPerformance, connectAudioInput, setRunning])


  /**
   * Make the rack able to make a sound, because somebody is about to play one.
   *
   * Two ways it can be unable to. It may never have been started, in which case this is the starting
   * gesture like any other. Or it may be **suspended because the transport is stopped** — Stop suspends the
   * whole context, which is the honest fix for a Clock that ignores `running`, and it had the side effect
   * that a keyboard went completely dead the moment somebody pressed Stop. Measured: holding a key with the
   * transport stopped drew a flat line on the scope.
   *
   * That is the wrong trade for an instrument. A sequencer being stopped is exactly when you want to play
   * something by hand, so a note resumes the context and **leaves the transport stopped** — `running` stays
   * false, so anything transport-locked stays where it is and only the sound comes back.
   *
   * Returns whether the rack had to be started from cold, because a note played into an audio thread that
   * did not exist yet needs playing again once it does.
   */
  const wake = useCallback(async (): Promise<boolean> => {
    if (!rack.current) {
      await start()
      return true
    }
    const ctx = rack.current.output?.context as AudioContext | undefined
    if (ctx?.state === 'suspended') void ctx.resume()
    return false
  }, [start])

  // Knob moves go straight to the audio thread. Subscribing rather than doing it in the handler keeps
  // the faceplates from needing the Rack at all — they only ever touch the store.
  // Let go of the devices on the way out, so a reload does not leave handlers on a closed page.
  useEffect(
    () => () => {
      midi.current?.close()
      audioInput.current?.close()
      bindGrooveboxPerformance(null)
      groovebox.current?.dispose()
    },
    [bindGrooveboxPerformance],
  )

  // The keyboards have to agree with the graph about how many voices there are, or a note lands on a voice
  // the audio thread does not have. `setVoices` silences everything, which is what recompiling does anyway.
  useEffect(() => {
    midi.current?.setVoices(voices)
  }, [voices])

  /**
   * Push the transport, and suspend the audio context when stopped.
   *
   * Both, and the second one is the fix for a real bug. Stop used to only set `running: false`, which the
   * Transport module honours and **nothing else does** — the Clock is free-running by design, so on the shipped
   * patches, which drive themselves from a Clock, Stop changed the button's label and nothing else. A stop button
   * that does not stop is worse than no stop button.
   *
   * Suspending is the honest answer unless a live input is being monitored. A pedal chain has to keep passing
   * audio while its sequencer transport is stopped, so an open Audio Input keeps the context awake and only the
   * transport message stops. The transport-driven patch still comes back in the right place.
   */
  useEffect(() => {
    const live = rack.current
    if (!live) return
    live.setTransport(tempo, playing, shuffle)
    // The rack's own playhead, kept beside the graph's. Starting rewinds and a tempo change banks what has
    // already elapsed, exactly as `Graph.setTransport` does — see `playhead.ts` for why recomputing from
    // total elapsed seconds would move every position already recorded.
    playhead.current = moveTo(
      playhead.current,
      live.output?.context.currentTime ?? 0,
      playing,
      tempo,
    )
    // An AudioWorkletNode's context is typed as BaseAudioContext, which has neither suspend nor resume — the rack
    // is always given a real AudioContext, so this is a narrowing rather than an assumption.
    const ctx = live.output?.context as AudioContext | undefined
    if (!ctx) return
    // A rack tempo is an explicit override. With no override, the hosted engine keeps
    // ownership of its song tempo and any recorded tempo automation.
    const hosted = groovebox.current
    if (patch.tempo !== undefined && hosted && hosted.bpm !== tempo) {
      hosted.bpm = tempo
    }
    if (playing) {
      void groovebox.current?.start()
      if (ctx.state === 'suspended') void ctx.resume()
    } else {
      groovebox.current?.stop()
      if (ctx.state === 'running' && audioInputState !== 'on') void ctx.suspend()
    }
  }, [audioInputState, patch.tempo, playing, shuffle, tempo])

  /**
   * Tell the store where the transport is, so an armed knob turn records somewhere real.
   *
   * A callback rather than a pushed number, so the position is read at the instant the knob moves. Null
   * while there is no rack at all, which is what makes recording before `Start audio` a no-op rather than
   * a pile of points at step zero.
   */
  useEffect(() => {
    const read = () => {
      const ctx = rack.current?.output?.context
      if (!ctx) return null
      return stepAt(playhead.current, ctx.currentTime)
    }
    useRack.getState().setAutomationPosition(read)
    return () => useRack.getState().setAutomationPosition(null)
  }, [])

  /**
   * Play the lanes back.
   *
   * `LanePlayer` is this, moved into `@driftbox/rack` — it was forty lines here, which meant a patch opened
   * by anything that is not this app played the patch and not the performance. The scheduler is unchanged
   * in design: a lookahead window, each point handed over with `scheduleParam` and the frame it belongs at,
   * so the 100ms tick decides only how far ahead work is done and never where a value lands.
   *
   * It reads its position from `Rack.beat`, which is the same banked arithmetic `playhead.ts` does for the
   * screen — one clock, two readers, so the knob and the sound cannot disagree.
   *
   * Playback goes straight to the audio thread rather than through the store, and that is load-bearing:
   * recording writes through `setParam`, which is also what a knob does, so a lane played back into the
   * store would record itself, one point per tick, for ever.
   */
  useEffect(() => {
    if (!playing) return
    // Built on the first tick that finds a rack rather than when the effect runs, because `playing` can
    // turn true before the node exists and an effect that gave up then would leave the lanes silent until
    // somebody pressed stop and play again. A fresh player also replays from the top: it seeds its window
    // just before the current position, so a point at step zero is due rather than skipped.
    let lanes: LanePlayer | null = null
    const tick = () => {
      const live = rack.current
      if (!live) return
      lanes ??= new LanePlayer(live)
      lanes.advance(useRack.getState().patch.automation)
    }
    tick()
    const timer = window.setInterval(tick, 100)
    return () => window.clearInterval(timer)
  }, [playing])

  /**
   * Move the knobs the lanes are driving.
   *
   * The same lane and the same playhead that decided what the audio thread was told, read again for the
   * screen — so the panel and the sound are the same number computed twice rather than two channels that
   * can disagree. See `live.ts` for why this is derived here instead of reported from the worklet.
   *
   * An animation frame rather than the scheduler's 100ms tick: this is only ever a picture, and a knob
   * that stepped ten times a second would read as a broken knob rather than a moving one.
   */
  useEffect(() => {
    if (!playing) {
      clearLive()
      return
    }
    let frame = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const ctx = rack.current?.output?.context
      const lanes = useRack.getState().patch.automation
      if (!ctx || !lanes || lanes.length === 0) return clearLive()
      const at = stepAt(playhead.current, ctx.currentTime)
      const next = new Map<string, Record<string, number>>()
      for (const lane of lanes) {
        const value = valueAt(lane, at)
        // Undefined before a lane's first point, which is what leaves the knob its own value until the
        // recording actually starts. Publishing a number there would take the knob over at the top of the
        // arrangement, which is precisely what `valueAt` refuses to do.
        if (value === undefined) continue
        const forModule = next.get(lane.target[0]) ?? {}
        forModule[lane.target[1]] = value
        next.set(lane.target[0], forModule)
      }
      publishLive(next)
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      clearLive()
    }
  }, [playing])

  useEffect(() => {
    return useRack.subscribe((state, previous) => {
      const live = rack.current
      // **Deliberately not `state.revision === previous.revision`.** That guard was here because a
      // structural edit rebuilds the graph anyway, and a rebuild seeds params and data from the plan —
      // so pushing them too was redundant. Undo made it wrong: a restore can change the structure *and*
      // a module's data in one step, and data is the one thing a rebuild does not re-seed, because the
      // Graph keeps pushed data in `pushed` and `pushed` beats `seeded` — the rule that stops a
      // recompile throwing away a loaded break. Without this push, undoing a removed Tracker brings the
      // module back playing the pattern it had *before* the undo. Pushing on every patch change costs a
      // walk of the module list against references that are usually identical.
      if (!live || state.patch === previous.patch) return
      for (const module of state.patch.modules) {
        const before = previous.patch.modules.find((m) => m.id === module.id)
        if (!before) continue
        if (before.params !== module.params) {
          for (const [id, value] of Object.entries(module.params ?? {})) {
            if (before.params?.[id] !== value) live.setParam(module.id, id, value)
          }
        }
        if (before.inputTrims !== module.inputTrims) {
          const ports = new Set([
            ...Object.keys(before.inputTrims ?? {}),
            ...Object.keys(module.inputTrims ?? {}),
          ])
          for (const port of ports) {
            const value = module.inputTrims?.[port] ?? 1
            if ((before.inputTrims?.[port] ?? 1) !== value) {
              live.setInputTrim(module.id, port, value)
            }
          }
        }
        // Pattern data takes the same road as a knob, and for the same reason: `data` is compiled into the
        // plan, so treating an edit as structural would rebuild every processor on every cell you touched.
        // Sent as a `data` message instead, which the Graph keeps in `pushed` — and `pushed` beats `seeded`,
        // which is precisely why recompiling never throws away a loaded break. A pattern is the same shape.
        if (before.data !== module.data) {
          for (const [slot, values] of Object.entries(module.data ?? {})) {
            if (before.data?.[slot] === values) continue
            // A fresh array every time, because `setData` **transfers** it — the buffer is gone on this side
            // the moment it is sent, and the patch's own copy must not be the one that leaves.
            live.setData(module.id, slot, Float32Array.from(values))
          }
        }
      }
    })
  }, [])

  // `s.notes` and not `s.notes.filter(...)`. A selector that builds a new array every call hands
  // zustand a different snapshot on every render, and `useSyncExternalStore` responds by rendering
  // again — an infinite loop, which React reports as "Maximum update depth exceeded" and a blank page.
  // Derive outside the selector, always.
  const notes = useRack((s) => s.notes)
  /** Samples that came from somebody's own file rather than a shipped break. Only these break a link. */
  const loadedFiles = useMemo(
    () =>
      [
        ...Object.values(samples)
          .filter((entry) => entry.source === 'file')
          .map((entry) => entry.name),
        ...Object.values(multisamples).flatMap((entries) => entries.map((entry) => entry.name)),
      ],
    [multisamples, samples],
  )

  const placeholders = useMemo(
    () => notes.filter((note) => note.kind === 'placeholder'),
    [notes],
  )

  return (
    <div
      className="rk"
      data-playing={playing ? 'yes' : 'no'}
      data-audio={audioState}
      data-keyboard={keyboardOpen ? 'open' : 'closed'}
    >
      <header className="rk-header">
        <h1>
          Driftbox <span>Rack</span>
        </h1>
        {name && <span className="rk-open">{name}</span>}
        {loadedBreak && <span className="rk-open">Break · {loadedBreak.name}</span>}

        {!started && !failed && (
          <button type="button" className="rk-primary" onClick={start}>
            Start audio
          </button>
        )}
        {failed && <span className="rk-warn">No AudioWorklet — this browser cannot run a rack.</span>}

        <button type="button" onClick={() => flip()} aria-pressed={flipped}>
          {flipped ? 'Front' : 'Back'} <kbd>Tab</kbd>
        </button>

        {/* Buttons as well as the shortcut, the same standard the back panel holds itself to — where
            Enter arms a jack because a rack whose whole point is the cables is a poor thing to make
            mouse-only. This is the other direction: a keyboard-only undo is invisible, and undo is the
            one feature nobody looks for until they need it in a hurry. */}
        <span className="rk-undo">
          <button type="button" onClick={() => undo()} disabled={!canUndo} title="Undo — Ctrl/Cmd+Z">
            ↶ Undo
          </button>
          <button
            type="button"
            onClick={() => redo()}
            disabled={!canRedo}
            title="Redo — Ctrl/Cmd+Shift+Z"
          >
            ↷ Redo
          </button>
        </span>

        <button
          type="button"
          onClick={() => {
            setAdding((open) => !open)
            setBrowsing(false)
          }}
          aria-expanded={adding}
        >
          Add module
        </button>

        {/* No extra class: the header already styles `aria-pressed` buttons, the way the flip button does.
            A custom filled style put teal text on a teal background and the label vanished. */}
        <button
          type="button"
          onClick={cycleRackView}
          aria-pressed={performing}
          aria-label={`View: ${rackView}. Cycle through rack, split performance, and full pad.`}
          title="Cycle view: Rack → Split → Pad"
        >
          View · {rackView[0].toUpperCase() + rackView.slice(1)}
        </button>

        <button
          type="button"
          onClick={() => {
            setBrowsing((open) => !open)
            setAdding(false)
          }}
          aria-expanded={browsing}
        >
          Patches
        </button>

        {started && (
          <>
            <button type="button" onClick={() => setRunning(!playing)} aria-pressed={playing}>
              {playing ? '■ Stop' : '▶ Play'}
            </button>
            {/* Arm. Beside the transport rather than on a faceplate, because it arms every knob in the
                rack at once — a per-module control would imply you had to arm the one you were about to
                touch, which is the opposite of how recording a performance works. `aria-pressed` gets the
                header's own on-state styling, the same as the flip and perform buttons. */}
            <button
              type="button"
              className={automating ? 'rk-arm rk-arm-on' : 'rk-arm'}
              onClick={() => setAutomating(!automating)}
              aria-pressed={automating}
              title="Record knob moves onto the arrangement"
            >
              ● Rec
            </button>
            <label className="rk-voices">
              BPM
              <input
                type="number"
                min={20}
                max={400}
                value={Math.round(tempo)}
                aria-label="Tempo"
                onChange={(event) => setTempo(Number(event.target.value))}
              />
            </label>
          </>
        )}

        <label
          className="rk-voices"
          title={
            voices > 1 && !hasMidi
              ? 'Nothing here plays different notes on different voices, so every voice plays the same one — and the output is that many times louder. Add a MIDI module.'
              : undefined
          }
        >
          Voices
          <select
            value={voices}
            onChange={(event) => setVoices(Number(event.target.value))}
            aria-label="Voices"
          >
            {[1, 2, 3, 4, 5, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        {midiState !== 'unavailable' ? (
          <button
            type="button"
            onClick={toggleMidi}
            aria-pressed={midiState === 'on'}
            disabled={!started}
            title={started ? undefined : 'Start audio first'}
          >
            {/* "MIDI in" rather than "MIDI": the palette has a button for the module itself, and two
                controls sharing an accessible name is ambiguous to a screen reader and to a test. */}
            MIDI in{midiState === 'on' && midiInputs.length > 0 ? ` · ${midiInputs.length}` : ''}
          </button>
        ) : (
          <span className="rk-warn">No Web MIDI in this browser.</span>
        )}

        {hasAudioInput && audioInputState === 'on' && (
          <>
            <label className="rk-voices rk-input-device">
              Input
              <select
                value={selectedAudioInput}
                aria-label="Audio input device"
                onChange={(event) => void connectAudioInput(event.target.value)}
              >
                {selectedAudioInput &&
                  !audioInputs.some((device) => device.id === selectedAudioInput) && (
                    <option value={selectedAudioInput}>Current audio input</option>
                  )}
                {audioInputs.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={closeAudioInput} aria-pressed="true">
              Input on
            </button>
          </>
        )}
        {hasAudioInput && audioInputState !== 'on' && audioInputState !== 'unavailable' && (
          <button
            type="button"
            className="rk-primary"
            disabled={!started || audioInputState === 'opening'}
            title={started ? 'Allow and monitor a microphone or audio interface' : 'Start audio first'}
            onClick={() => void connectAudioInput()}
          >
            {audioInputState === 'opening' ? 'Opening input…' : 'Enable input'}
          </button>
        )}
        {hasAudioInput && audioInputState === 'unavailable' && (
          <span className="rk-warn">No browser audio input here.</span>
        )}
        {hasAudioInput && audioInputError && <span className="rk-warn">{audioInputError}</span>}

        <button
          type="button"
          onClick={async () => {
            setShared(await patchShareLink(useRack.getState().patch))
            await navigator.clipboard?.writeText(shared ?? '').catch(() => {})
          }}
        >
          Copy link
        </button>

        <button
          type="button"
          disabled={exporting !== null}
          title="Render this patch to a WAV file"
          onClick={async () => {
            setExporting('patch')
            try {
              await exportPatch()
            } finally {
              setExporting(null)
            }
          }}
        >
          {exporting === 'patch' ? 'Rendering patch…' : 'Patch WAV'}
        </button>

        {retainedSong && (
          <>
            <button
              type="button"
              disabled={exporting !== null}
              title="Render the retained Groovebox song through its mastered stereo bus"
              onClick={async () => {
                setExporting('song')
                try {
                  await exportGrooveboxMix()
                } finally {
                  setExporting(null)
                }
              }}
            >
              {exporting === 'song' ? 'Rendering song…' : 'Song WAV'}
            </button>
            <button
              type="button"
              disabled={exporting !== null}
              title="Preview or export the retained song as one pre-master WAV per voice"
              onClick={() => setReviewingStems(true)}
            >
              Song stems
            </button>
          </>
        )}

        <button
          type="button"
          className="rk-help-trigger"
          onClick={() => setHelpOpen(true)}
          aria-label="Open help"
          aria-keyshortcuts="?"
          title="Help (?)"
        >
          ? Help
        </button>

        {patch.groovebox && !retainedSong ? (
          <span
            className="rk-away rk-away-disabled"
            title="This sequencer build cannot safely open the retained future song"
          >
            Sequencer unavailable
          </span>
        ) : (
          <a
            className="rk-away"
            href="./index.html"
            onClick={(event) => {
              if (!patch.groovebox) return
              event.preventDefault()
              if (
                compatibility === 'rack-extended' &&
                !confirm(
                  'This opens only the retained groovebox song. Your rack modules, cables and other rack-only changes stay saved in rack mode. Continue?',
                )
              ) {
                return
              }
              // Do not leave the newest rack edit waiting in the trailing autosave timer while
              // navigation unloads the page.
              storePatch(patch)
              void sequencerLink(patch).then((url) => {
                if (url) window.location.assign(url)
              })
            }}
            title={
              patch.groovebox
                ? compatibility === 'rack-extended'
                  ? 'Open the retained song; rack-only additions stay saved in rack mode'
                  : 'Return to the sequencer with the retained song'
                : undefined
            }
          >
            Sequencer →
          </a>
        )}
      </header>

      {compatibility !== 'rack-native' && (
        <p className="rk-document">
          <strong>{compatibility}</strong>
          {' · '}
          {retainedSong
            ? `${retainedSong.patterns.length} patterns at ${retainedSong.bpm} BPM retained exactly.`
            : 'A song from a newer groovebox build is retained exactly but cannot be edited here.'}
          {' · '}
          {retainedSong
            ? compatibility === 'rack-extended'
              ? 'The retained song plays here; cabled machines run through the Groovebox source, and “Sequencer →” keeps those rack additions saved here.'
              : 'The retained song plays through its original mix; patch a Groovebox output to route that machine through the rack. “Sequencer →” returns without loss.'
            : 'This build will preserve it, but will not send it to a sequencer that cannot decode it.'}
        </p>
      )}

      {adding && (
        <div className="rk-palette-layer">
          <Palette
            onClose={() => setAdding(false)}
            onModule={(type) => {
              addModule(type)
              setAdding(false)
            }}
            onChunk={(chunk) => {
              const added = addChunk(chunk)
              setAdding(false)
              // A Sampler with nothing in it is silent, so a chunk that needs one is offered whatever the
              // patch is already holding. Same reasoning as `ensureSampler`: a freshly dropped thing has
              // to make a sound.
              if (chunk.needsSample && intendedBreak) {
                const sampler = Object.entries(added.ids).find(
                  ([local]) => chunk.modules.find((m) => m.id === local)?.type === 'sampler',
                )
                if (sampler) void loadBreak(intendedBreak)
              }
            }}
          />
        </div>
      )}

      {/* `onLoadBreak` is always passed now, not only once audio has started: `loadBreak` records which
          break a patch wants even when there is no live rack to push it to, and the export needs that. */}
      {browsing && (
        <PatchBrowser onClose={() => setBrowsing(false)} onLoadBreak={loadBreak} />
      )}

      {/* Above the rack rather than inside it, and shown on the front and the back alike: a routing is
          about the whole patch, not about the module whose faceplate opened it. It renders nothing at all
          unless a Combinator has been opened, so it costs an unrouted rack one null check. */}
      <Modulation />

      {shared && <p className="rk-shared">{shared}</p>}
      {/* `docs/DNB.md` asked for this in as many words: a patch using a loaded sample cannot travel in a URL
          and should say so plainly rather than silently sharing a broken link. The shipped breaks are fine —
          they are named, not carried, and the other end renders its own. */}
      {shared && loadedFiles.length > 0 && (
        <p className="rk-warn">
          {loadedFiles.length === 1
            ? `That link does not carry “${loadedFiles[0]}” — whoever opens it gets the patch with an empty sampler.`
            : `That link does not carry ${loadedFiles.length} loaded samples — whoever opens it gets the patch with empty samplers.`}
        </p>
      )}

      {started && playing && audioState === 'suspended' && (
        <p className="rk-warn">
          The browser has suspended audio — press Play again, or click anywhere on the page.
        </p>
      )}

      {audioInputState === 'on' && (
        <p className="rk-warn">
          Live input is monitoring through the rack. Use headphones or an audio interface to avoid speaker
          feedback.
        </p>
      )}

      {voices > 1 && !hasMidi && (
        <p className="rk-warn">
          {voices} voices, and no MIDI module to play different notes on them — so every voice plays the same
          note and the output is {voices}× louder. That is the summing being correct rather than a bug; add a
          MIDI module to hear it as a chord.
        </p>
      )}

      {placeholders.length > 0 && (
        <p className="rk-warn">
          {placeholders.length === 1
            ? '1 module in this patch is not in this build. It is kept and will be saved, but it makes no sound.'
            : `${placeholders.length} modules in this patch are not in this build. They are kept and will be saved, but they make no sound.`}
        </p>
      )}

      {/* Three views of the same live instrument. In split view the stage and pad share one grid, which moves
          the rack left into its own bay instead of shrinking it — its design coordinates, knobs and cable
          hit targets therefore stay exact. On a narrow screen the pair remains horizontally scrollable. */}
      <div ref={performanceSpace} className={`rk-performance-space rk-performance-space-${rackView}`}>
        {rackView !== 'rack' && (
          <div className="rk-perform">
            <PerformPad
              kaoss={hasKaoss ? kaoss.current : null}
              flipped={flipped}
              scene={performanceScene}
              setScene={setVisual}
              analyser={analyser}
              running={playing}
              bpm={tempo}
            />
          </div>
        )}

        <div className="rk-stage" hidden={rackView === 'pad'}>
          {/* Keep the view-transition capture outside the element that turns in 3D. Chromium flattens a
              named transition participant; naming rk-rack itself left its rear face unpaintable after a
              Pad → Rack hand-off even though its transform and opacity were correct. */}
          <div
            className="rk-rack-snapshot"
            style={{
              width: geometry.width,
              height: geometry.height,
            }}
          >
            <div className={flipped ? 'rk-rack rk-rack-flipped' : 'rk-rack'}>
              <div className="rk-side rk-side-front">
                <Chassis layout={geometry} />
              </div>
              <div className="rk-side rk-side-back">
                <BackPanel layout={geometry} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {started && (
        <div className="rk-scope">
          {/* No `colour`: it becomes a canvas strokeStyle, which cannot read a CSS custom property — it
              would silently keep whatever was set last. The default is already --nine's value. */}
          <Oscilloscope analyser={analyser} mode="wave" height={70} />
        </div>
      )}

      {/* The sticky keyboard otherwise sits over the lower row of the patch browser. It has no useful
          action while choosing a replacement system, so let the browser own the viewport until it closes. */}
      {!browsing && (
        <RackKeys
          open={keyboardOpen}
          onOpenChange={setKeyboardOpen}
          wake={wake}
          down={keysDown}
          up={keysUp}
          allOff={keysAllOff}
          sounding={sounding}
        />
      )}

      {reviewingStems && retainedSong && (
        <StemReviewTray
          song={retainedSong}
          running={playing}
          stopTransport={() => setRunning(false)}
          filePrefix={name ?? 'driftbox-song'}
          onClose={() => setReviewingStems(false)}
          onExported={() => setReviewingStems(false)}
        />
      )}

      <footer className="rk-footer">
        <span>
          {patch.modules.length} modules · {patch.cables.length} cables
        </span>
        <span className="rk-hint">
          {rackView === 'split'
            ? flipped
              ? 'Patch while you perform · the creature keeps the filter live'
              : 'Drag knobs and pad together · Tab turns both around'
            : rackView === 'pad'
              ? flipped
                ? 'The creature lives back here · the filter still works'
                : 'Drag the pad · Tab to see what is behind it'
            : flipped
              ? 'Drag between jacks to patch · × beside an input unplugs'
              : 'Drag a knob · Tab for the back'}
        </span>
        {/* Last, and quiet. It is the answer to "which build is this?" — asked once, when something is
            wrong — so it should be findable rather than prominent. */}
        <span className="rk-build" title={buildTitle()}>
          {buildLabel()}
        </span>
      </footer>
      {helpOpen && <HelpDialog surface="rack" onClose={() => setHelpOpen(false)} />}
    </div>
  )
}
