import {
  MODULES,
  grooveboxSong,
  patchCompatibility,
  patchStemTargets,
  renderPatch,
  renderRetainedSongMix,
} from '@driftbox/rack'
import { useCallback, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { HelpDialog } from '../ui/HelpDialog.js'
import { StemReviewTray } from '../ui/StemTray.js'
import { Oscilloscope } from '../visual/Oscilloscope.js'
import { SCENES } from '../visual/scenes/index.js'
import { AutomationDesk } from './AutomationDesk.js'
import { DocumentNotice } from './DocumentNotice.js'
import { documentNotice, leavingWarning, sequencerTitle } from './document-notice.js'
import { downloadWav, wavFileName } from './download.js'
import { sizeFor } from './faceplates/index.js'
import { layout } from './layout.js'
import { Modulation } from './Modulation.js'
import { useRackNodes } from './nodes.js'
import { Palette } from './Palette.js'
import { PatchBrowser } from './PatchBrowser.js'
import { PerformPad } from './PerformPad.js'
import { patchShareLink, sequencerLink, storePatch } from './persistence.js'
import { RackFooter } from './RackFooter.js'
import { RackHeader } from './RackHeader.js'
import { RackKeys } from './RackKeys.js'
import { RackStage } from './RackStage.js'
import { RackStemReviewTray } from './RackStemReviewTray.js'
import { RackWarnings } from './RackWarnings.js'
import { useRack } from './store.js'
import { TourOffer } from './TourOffer.js'
import { TutorialCoach } from './TutorialCoach.js'
import { type TutorialState } from './tutorials.js'
import { useAudioInput } from './useAudioInput.js'
import { useGuidedTour } from './useGuidedTour.js'
import { useOpeningPatch } from './useOpeningPatch.js'
import { useRackEngine } from './useRackEngine.js'
import { useRackKeyboards } from './useRackKeyboards.js'
import { useRackShortcuts } from './useRackShortcuts.js'
import { useRackView } from './useRackView.js'
import { useSampleBank } from './useSampleBank.js'
import { rackWarnings } from './warnings.js'

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
//
// **This file is the assembly and nothing else.** It grew to seventeen hundred lines because a page that
// hosts a synth, a sequencer's worth of retained song, two kinds of keyboard, a sampler, a microphone and
// three exports genuinely has that much to hold — but almost none of it was about *this* component. The
// pieces now live where they can be read and tested on their own:
//
//   `useRackNodes`      the two live audio objects everything else shares
//   `useRackEngine`     starting audio, and keeping the graph in step with the document
//   `useSampleBank`     every piece of audio the patch is made of, and getting it back for an export
//   `useRackKeyboards`  notes, controllers, and the performance/document line between them
//   `useAudioInput`     permission, device choice and the sentence shown when either fails
//   `useRackView`       Rack → Split → Pad, and the transition between them
//   `warnings.ts`       what the page says when something is not quite right
//
// What is left here is the wiring: which hook's output is which component's prop.

export default function RackApp() {
  const patch = useRack((s) => s.patch)
  const name = useRack((s) => s.name)
  const flipped = useRack((s) => s.flipped)
  const flip = useRack((s) => s.flip)
  const undo = useRack((s) => s.undo)
  const redo = useRack((s) => s.redo)
  const addModule = useRack((s) => s.addModule)
  const addChunk = useRack((s) => s.addChunk)
  const setVisual = useRack((s) => s.setVisual)
  const playing = useRack((s) => s.running)
  const setRunning = useRack((s) => s.setRunning)
  const automating = useRack((s) => s.automating)
  const voices = useRack((s) => s.patch.voices ?? 1)
  const hasMidi = useRack((s) => s.patch.modules.some((m) => m.type === 'midi'))
  /** Selected as the object, filtered outside. A selector that builds a new array returns a different
   *  reference every call and re-renders for ever — this app has had that bug once already. */
  const samples = useRack((s) => s.samples)
  const multisamples = useRack((s) => s.multisamples)
  // `s.notes` and not `s.notes.filter(...)`, for the same reason: a selector that builds a new array every
  // call hands zustand a different snapshot on every render, and `useSyncExternalStore` responds by
  // rendering again — an infinite loop, which React reports as "Maximum update depth exceeded" and a blank
  // page. Derive outside the selector, always.
  const notes = useRack((s) => s.notes)

  const compatibility = useMemo(() => patchCompatibility(patch), [patch])
  const patchStemCount = useMemo(() => patchStemTargets(patch, MODULES).length, [patch])
  const retainedSong = useMemo(() => grooveboxSong(patch), [patch])
  const performanceScene = retainedSong?.visual ?? patch.visual ?? SCENES[0].id
  // Until hosted song playback lands, a compatible rack still follows the retained song's tempo. Writing a
  // different tempo is an explicit rack override and therefore changes the compatibility state to
  // rack-extended.
  const tempo = patch.tempo ?? retainedSong?.bpm ?? 120
  const shuffle = retainedSong?.swing ?? 0
  const geometry = useMemo(() => layout(patch.modules, sizeFor(MODULES)), [patch.modules])

  const [keyboardOpen, setKeyboardOpen] = useState(true)
  const [shared, setShared] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [reviewingPatchStems, setReviewingPatchStems] = useState(false)
  const [reviewingSongStems, setReviewingSongStems] = useState(false)
  const [automationOpen, setAutomationOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [exporting, setExporting] = useState<'patch' | 'song' | null>(null)

  const nodes = useRackNodes()
  const { loadedBreak, intendedBreak, setIntendedBreak, loadBreak, patchRenderData, hydrate } =
    useSampleBank(nodes)
  useOpeningPatch(setIntendedBreak)
  const {
    hasAudioInput,
    state: audioInputState,
    error: audioInputError,
    devices: audioInputs,
    selected: selectedAudioInput,
    connect: connectAudioInput,
    close: closeAudioInput,
  } = useAudioInput(nodes)
  const { sounding, midiState, toggleMidi, down, up, allOff } = useRackKeyboards(nodes)
  const { started, failed, analyser, kaoss, hasKaoss, audioState, start, wake } = useRackEngine(
    nodes,
    {
      song: retainedSong,
      encodedSong: patch.groovebox,
      tempoOverride: patch.tempo,
      tempo,
      shuffle,
      playing,
      audioInputState,
      connectAudioInput,
      hydrate,
      loadBreak,
    },
  )

  const closePanels = useCallback(() => {
    setAdding(false)
    setBrowsing(false)
  }, [])
  const { rackView, performing, viewCycled, cycleRackView, performanceSpace } =
    useRackView(closePanels)
  const {
    tour,
    start: startTour,
    close: closeTour,
    finish: finishTour,
    offered: tourOffered,
    decline: declineTour,
    tutorials,
  } = useGuidedTour()

  useRackShortcuts({
    onHelp: useCallback(() => setHelpOpen(true), []),
    onFlip: flip,
    onUndo: undo,
    onRedo: redo,
  })

  /** Samples that came from somebody's own file rather than a shipped break. Only these break a link. */
  const loadedFiles = useMemo(
    () => [
      ...Object.values(samples)
        .filter((entry) => entry.source === 'file')
        .map((entry) => entry.name),
      ...Object.values(multisamples).flatMap((entries) => entries.map((entry) => entry.name)),
    ],
    [multisamples, samples],
  )
  const placeholders = useMemo(
    () => notes.filter((note) => note.kind === 'placeholder').length,
    [notes],
  )
  const warnings = useMemo(
    () =>
      rackWarnings({
        started,
        playing,
        audioState,
        hasAudioInput,
        audioInputState,
        audioInputError,
        voices,
        hasMidi,
        placeholders,
        shared: shared !== null,
        loadedFiles,
      }),
    [
      audioInputError,
      audioInputState,
      audioState,
      hasAudioInput,
      hasMidi,
      loadedFiles,
      placeholders,
      playing,
      shared,
      started,
      voices,
    ],
  )
  const notice = useMemo(
    () =>
      documentNotice(
        compatibility,
        retainedSong ? { patterns: retainedSong.patterns.length, bpm: retainedSong.bpm } : null,
      ),
    [compatibility, retainedSong],
  )

  /**
   * Copy a link to this patch, and put the link that was just made on the clipboard.
   *
   * The local rather than `shared`: that is state this closure captured before the link existed, so
   * writing it copied whatever the *previous* press had left there — and on the first press of a session,
   * nothing at all. Silent, and indistinguishable from a browser refusing clipboard access.
   */
  const copyLink = useCallback(async () => {
    const link = await patchShareLink(useRack.getState().patch)
    setShared(link)
    await navigator.clipboard?.writeText(link).catch(() => {})
  }, [])

  /**
   * Render the patch to a WAV and hand it over.
   *
   * Offline rather than a recording of what is playing — see the note at the top of `render.ts`. It does
   * not need the live rack at all, which is the useful part: exporting works before audio has ever been
   * started, and a patch shared as a link can be turned into a file without pressing play.
   */
  const exportPatchWav = useCallback(async () => {
    setExporting('patch')
    try {
      const current = useRack.getState().patch
      const data = await patchRenderData(current)
      const buffer = await renderPatch(current, {
        registry: MODULES,
        bars: 8,
        sampleRate: 44100,
        data,
      })
      downloadWav(buffer, wavFileName(useRack.getState().name, 'driftbox-rack'))
    } finally {
      setExporting(null)
    }
  }, [patchRenderData])

  /**
   * Export the retained authored document without flattening rack-only changes into it.
   *
   * Rack mode remains a strict superset of the sequencer: opening a song here must not take its original
   * mastered WAV away. This is deliberately separate from Patch WAV; the latter renders rack modules and
   * cables, while this recalls the intact Groovebox song that can travel back to the sequencer.
   */
  const exportSongWav = useCallback(async () => {
    if (!retainedSong) return
    setExporting('song')
    try {
      const buffer = await renderRetainedSongMix(useRack.getState().patch)
      if (!buffer) return
      downloadWav(buffer, wavFileName(useRack.getState().name, 'driftbox-song', '-mix'))
    } finally {
      setExporting(null)
    }
  }, [retainedSong])

  const leaveForSequencer = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (!patch.groovebox) return
      event.preventDefault()
      const warning = leavingWarning(compatibility)
      if (warning && !confirm(warning)) return
      // Do not leave the newest rack edit waiting in the trailing autosave timer while navigation
      // unloads the page.
      storePatch(patch)
      void sequencerLink(patch).then((url) => {
        if (url) window.location.assign(url)
      })
    },
    [compatibility, patch],
  )

  /**
   * Everything a guided tour is allowed to know, gathered in one place.
   *
   * A snapshot rather than the store, and this is the boundary that keeps `tutorials.ts` testable in Node:
   * a step is a function of these seven fields and of nothing else — no hooks, no zustand, no DOM. The
   * count rather than the note numbers, because no lesson cares which key is down.
   */
  const tourState = useMemo<TutorialState>(
    () => ({
      patch,
      started,
      playing,
      flipped,
      automating,
      sounding: sounding.length,
      automationOpen,
    }),
    [patch, started, playing, flipped, automating, sounding, automationOpen],
  )

  return (
    <div
      className="rk"
      data-playing={playing ? 'yes' : 'no'}
      data-audio={audioState}
      data-keyboard={keyboardOpen ? 'open' : 'closed'}
    >
      <RackHeader
        loadedBreakName={loadedBreak?.name ?? null}
        started={started}
        failed={failed}
        onStart={() => void start()}
        automationOpen={automationOpen}
        onOpenAutomation={() => setAutomationOpen(true)}
        adding={adding}
        onToggleAdd={() => {
          setAdding((open) => !open)
          setBrowsing(false)
        }}
        browsing={browsing}
        onToggleBrowse={() => {
          setBrowsing((open) => !open)
          setAdding(false)
        }}
        rackView={rackView}
        performing={performing}
        onCycleView={cycleRackView}
        midiState={midiState}
        onToggleMidi={() => void toggleMidi()}
        hasAudioInput={hasAudioInput}
        audioInputState={audioInputState}
        audioInputs={audioInputs}
        selectedAudioInput={selectedAudioInput}
        onSelectAudioInput={(id) => void connectAudioInput(id)}
        onCloseAudioInput={closeAudioInput}
        exporting={exporting}
        patchStemCount={patchStemCount}
        hasRetainedSong={retainedSong !== null && retainedSong !== undefined}
        onCopyLink={copyLink}
        onExportPatch={() => void exportPatchWav()}
        onReviewPatchStems={() => setReviewingPatchStems(true)}
        onExportSong={() => void exportSongWav()}
        onReviewSongStems={() => setReviewingSongStems(true)}
        tempo={tempo}
        onHelp={() => setHelpOpen(true)}
        sequencerBlocked={Boolean(patch.groovebox) && !retainedSong}
        sequencerTitle={sequencerTitle(compatibility, Boolean(patch.groovebox))}
        onSequencer={leaveForSequencer}
      />

      <DocumentNotice notice={notice} />

      {!tourOffered && !tour && (
        <TourOffer onStart={() => startTour(tutorials[0].id)} onDecline={declineTour} />
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
      {browsing && <PatchBrowser onClose={() => setBrowsing(false)} onLoadBreak={loadBreak} />}

      {/* Above the rack rather than inside it, and shown on the front and the back alike: a routing is
          about the whole patch, not about the module whose faceplate opened it. It renders nothing at all
          unless a Combinator has been opened, so it costs an unrouted rack one null check. */}
      <Modulation />

      <RackWarnings shared={shared} warnings={warnings} />

      <RackStage
        rackView={rackView}
        viewCycled={viewCycled}
        performanceSpace={performanceSpace}
        geometry={geometry}
        flipped={flipped}
        pad={
          <PerformPad
            kaoss={hasKaoss ? kaoss.current : null}
            flipped={flipped}
            scene={performanceScene}
            setScene={setVisual}
            analyser={analyser}
            running={playing}
            bpm={tempo}
          />
        }
      />

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
          down={down}
          up={up}
          allOff={allOff}
          sounding={sounding}
        />
      )}

      {reviewingPatchStems && (
        <RackStemReviewTray
          patch={patch}
          running={playing}
          stopTransport={() => setRunning(false)}
          filePrefix={name ?? 'driftbox-rack'}
          prepareData={patchRenderData}
          onClose={() => setReviewingPatchStems(false)}
          onExported={() => setReviewingPatchStems(false)}
        />
      )}

      {reviewingSongStems && retainedSong && (
        <StemReviewTray
          song={retainedSong}
          running={playing}
          stopTransport={() => setRunning(false)}
          filePrefix={name ?? 'driftbox-song'}
          onClose={() => setReviewingSongStems(false)}
          onExported={() => setReviewingSongStems(false)}
        />
      )}

      {automationOpen && <AutomationDesk onClose={() => setAutomationOpen(false)} />}

      <RackFooter
        modules={patch.modules.length}
        cables={patch.cables.length}
        rackView={rackView}
        flipped={flipped}
      />

      {tour && (
        <TutorialCoach
          tutorial={tour}
          state={tourState}
          onClose={closeTour}
          onFinished={finishTour}
        />
      )}

      {helpOpen && (
        <HelpDialog
          surface="rack"
          onClose={() => setHelpOpen(false)}
          tutorials={tutorials}
          onStartTutorial={startTour}
        />
      )}
    </div>
  )
}
