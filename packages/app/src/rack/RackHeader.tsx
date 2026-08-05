import type { MouseEvent } from 'react'
import type { AudioInputDevice } from './audio-input.js'
import { HeaderMenu } from './HeaderMenu.js'
import { useRack } from './store.js'

// The rack's toolbar.
//
// **It had become twenty-one controls in one wrapping row, all the same shape.** Play sat between Patches
// and Automation; Patch stems, which somebody presses once a session, looked exactly like Back, which they
// press every few seconds. Finding anything meant reading every label, because nothing in the row said
// what kind of thing it was — and `flex-wrap` then broke the row at whatever character count the window
// happened to be, so the clusters that did exist in somebody's head were split across lines at random.
//
// Three changes, and the second is the one nobody would ask for by name.
//
// **1. Groups, ordered by how often a hand goes to them.** Transport, then building, then looking, then
// setup, then output, then the way out. Each is a real `role="group"` with a label, so the structure is
// there for a screen reader too rather than being a row of hairlines. Because a group is one flex item, a
// narrow window now wraps *between* clusters instead of through them.
//
// **2. Nothing moves.** The header already knew this mattered — `rack.css` says of undo, "a button that
// disappears when there is nothing to undo moves everything after it" — and then five other controls did
// exactly that. Start audio was a button in one place that became Play somewhere else; Rec, BPM and the
// two song renders appeared out of nowhere and shoved the row along. So: one transport slot that holds
// Start before audio and Play after it, Rec present and disabled until there is a timeline to record
// against, and the song renders inside a menu whose trigger is always the same width. The layout a person
// has learnt is the layout they get back.
//
// **3. The five ways out live behind one button.** See `HeaderMenu` for why that one and nothing else.
//
// It reads the store directly and takes props only for what belongs to the page rather than the document —
// audio having been started, which panel is open, a render in flight. That keeps the prop list about
// session state instead of restating the patch, and lets a browser test drive it with `useRack` the way
// every other rack component test does.

export type RackView = 'rack' | 'split' | 'pad'
export type AudioInputState = 'off' | 'opening' | 'on' | 'denied' | 'unavailable'

interface Props {
  loadedBreakName: string | null

  started: boolean
  failed: boolean
  onStart: () => void

  automationOpen: boolean
  onOpenAutomation: () => void

  adding: boolean
  onToggleAdd: () => void
  browsing: boolean
  onToggleBrowse: () => void

  rackView: RackView
  performing: boolean
  onCycleView: () => void

  midiState: 'off' | 'on' | 'unavailable'
  onToggleMidi: () => void

  hasAudioInput: boolean
  audioInputState: AudioInputState
  audioInputs: readonly AudioInputDevice[]
  selectedAudioInput: string
  onSelectAudioInput: (id?: string) => void
  onCloseAudioInput: () => void

  exporting: 'patch' | 'song' | null
  patchStemCount: number
  hasRetainedSong: boolean
  onCopyLink: () => void
  onExportPatch: () => void
  onReviewPatchStems: () => void
  onExportSong: () => void
  onReviewSongStems: () => void

  /**
   * Beats per minute as shown. Passed rather than read, because the answer is `patch.tempo` falling back
   * to a *retained song's* bpm — and decoding that envelope on every keystroke in this box, to redraw the
   * box, is work the page has already done and memoised.
   */
  tempo: number

  onHelp: () => void

  /** True when this build holds a song it cannot decode, so the sequencer cannot safely be handed it. */
  sequencerBlocked: boolean
  sequencerTitle?: string
  onSequencer: (event: MouseEvent<HTMLAnchorElement>) => void
}

export function RackHeader({
  loadedBreakName,
  started,
  failed,
  onStart,
  automationOpen,
  onOpenAutomation,
  adding,
  onToggleAdd,
  browsing,
  onToggleBrowse,
  rackView,
  performing,
  onCycleView,
  midiState,
  onToggleMidi,
  hasAudioInput,
  audioInputState,
  audioInputs,
  selectedAudioInput,
  onSelectAudioInput,
  onCloseAudioInput,
  exporting,
  patchStemCount,
  hasRetainedSong,
  onCopyLink,
  onExportPatch,
  onReviewPatchStems,
  onExportSong,
  onReviewSongStems,
  tempo,
  onHelp,
  sequencerBlocked,
  sequencerTitle,
  onSequencer,
}: Props) {
  const patch = useRack((s) => s.patch)
  const name = useRack((s) => s.name)
  const flipped = useRack((s) => s.flipped)
  const flip = useRack((s) => s.flip)
  const undo = useRack((s) => s.undo)
  const redo = useRack((s) => s.redo)
  // The depth rather than the history, so this re-renders when undo becomes available and not on every
  // step taken while it already was.
  const canUndo = useRack((s) => s.history.past.length > 0)
  const canRedo = useRack((s) => s.history.future.length > 0)
  const playing = useRack((s) => s.running)
  const setRunning = useRack((s) => s.setRunning)
  const automating = useRack((s) => s.automating)
  const setAutomating = useRack((s) => s.setAutomating)
  const voices = useRack((s) => s.patch.voices ?? 1)
  const setVoices = useRack((s) => s.setVoices)
  const hasMidi = useRack((s) => s.patch.modules.some((m) => m.type === 'midi'))
  const setTempo = useRack((s) => s.setTempo)
  const midiInputs = useRack((s) => s.midiInputs)

  const lanes = patch.automation?.length ?? 0

  return (
    <header className="rk-header">
      <div className="rk-mark">
        <h1>
          Driftbox <span>Rack</span>
        </h1>
        {name && <span className="rk-open">{name}</span>}
        {loadedBreakName && <span className="rk-open">Break · {loadedBreakName}</span>}
      </div>

      <div className="rk-group" role="group" aria-label="Transport">
        {/* One slot, two labels. Start and Play were never two decisions — `start()` sets the transport
            running in the same gesture, because arriving, pressing a button and getting silence is the
            problem `docs/DNB.md` names. Two buttons in two places said otherwise. */}
        {failed ? (
          <span className="rk-warn">No AudioWorklet — this browser cannot run a rack.</span>
        ) : started ? (
          <button type="button" onClick={() => setRunning(!playing)} aria-pressed={playing}>
            {playing ? '■ Stop' : '▶ Play'}
          </button>
        ) : (
          <button type="button" className="rk-primary" onClick={onStart}>
            Start audio
          </button>
        )}

        {/* Arm. Beside the transport rather than on a faceplate, because it arms every knob in the rack at
            once — a per-module control would imply you had to arm the one you were about to touch, which
            is the opposite of how recording a performance works. Disabled rather than absent before audio:
            arming with no rack running is already a no-op, and saying so in place beats saying it by
            appearing later and moving everything along. */}
        <button
          type="button"
          className={automating ? 'rk-arm rk-arm-on' : 'rk-arm'}
          onClick={() => setAutomating(!automating)}
          aria-pressed={automating}
          disabled={!started}
          title={started ? 'Record knob moves onto the arrangement' : 'Start audio first'}
        >
          ● Rec
        </button>

        {/* Always here, and enabled before audio, because tempo is part of the document rather than of the
            session — a patch is 174 whether or not anybody has pressed anything yet. */}
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

        <button
          type="button"
          onClick={onOpenAutomation}
          aria-expanded={automationOpen}
          title="Inspect and edit recorded rack parameter lanes"
        >
          Automation{lanes > 0 ? ` (${lanes})` : ''}
        </button>
      </div>

      <div className="rk-group" role="group" aria-label="Build">
        <button type="button" onClick={onToggleAdd} aria-expanded={adding}>
          Add module
        </button>
        <button type="button" onClick={onToggleBrowse} aria-expanded={browsing}>
          Patches
        </button>
        {/* Buttons as well as the shortcut, the same standard the back panel holds itself to — where Enter
            arms a jack because a rack whose whole point is the cables is a poor thing to make mouse-only.
            This is the other direction: a keyboard-only undo is invisible, and undo is the one feature
            nobody looks for until they need it in a hurry. */}
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
      </div>

      <div className="rk-group" role="group" aria-label="View">
        <button type="button" onClick={() => flip()} aria-pressed={flipped}>
          {flipped ? 'Front' : 'Back'} <kbd>Tab</kbd>
        </button>
        {/* No extra class: the header already styles `aria-pressed` buttons, the way the flip button does.
            A custom filled style put teal text on a teal background and the label vanished. */}
        <button
          type="button"
          onClick={onCycleView}
          aria-pressed={performing}
          aria-label={`View: ${rackView}. Cycle through rack, split performance, and full pad.`}
          title="Cycle view: Rack → Split → Pad"
        >
          View · {rackView[0].toUpperCase() + rackView.slice(1)}
        </button>
      </div>

      <div className="rk-group" role="group" aria-label="Rack setup">
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
            onClick={onToggleMidi}
            aria-pressed={midiState === 'on'}
            disabled={!started}
            title={started ? undefined : 'Start audio first'}
          >
            {/* "MIDI in" rather than "MIDI": the palette has a button for the module itself, and two
                controls sharing an accessible name is ambiguous to a screen reader and to a test. */}
            MIDI in{midiState === 'on' && midiInputs.length > 0 ? ` · ${midiInputs.length}` : ''}
          </button>
        ) : (
          <span className="rk-quiet">No Web MIDI</span>
        )}

        {hasAudioInput && audioInputState === 'on' && (
          <>
            <label className="rk-voices rk-input-device">
              Input
              <select
                value={selectedAudioInput}
                aria-label="Audio input device"
                onChange={(event) => onSelectAudioInput(event.target.value)}
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
            <button type="button" onClick={onCloseAudioInput} aria-pressed="true">
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
            onClick={() => onSelectAudioInput()}
          >
            {audioInputState === 'opening' ? 'Opening input…' : 'Enable input'}
          </button>
        )}
        {hasAudioInput && audioInputState === 'unavailable' && (
          <span className="rk-quiet">No audio input</span>
        )}
      </div>

      <div className="rk-group" role="group" aria-label="Share and render">
        <HeaderMenu
          // The progress lives on the trigger rather than on the button that started it, so a render still
          // says so after the menu has shut behind the press that began it.
          label={
            exporting === 'patch' ? 'Rendering patch…' : exporting === 'song' ? 'Rendering song…' : 'Export'
          }
          title="Share a link, or render this rack and any retained song to WAV"
        >
          <button type="button" onClick={onCopyLink}>
            Copy link
          </button>
          <button
            type="button"
            disabled={exporting !== null}
            title="Render this patch to a WAV file"
            onClick={onExportPatch}
          >
            Patch WAV
          </button>
          <button
            type="button"
            disabled={exporting !== null || patchStemCount === 0}
            title={
              patchStemCount > 0
                ? 'Preview or export one stereo WAV per terminal Out strip'
                : 'Add an Out module to define a rack stem'
            }
            onClick={onReviewPatchStems}
          >
            {`Patch stems${patchStemCount > 0 ? ` (${patchStemCount})` : ''}`}
          </button>
          {/* Inside the menu rather than beside it, which is the other half of why there is a menu: these
              two exist only for a patch holding a song, and as header buttons they appeared and vanished
              with the document and took the row's whole right-hand end with them. */}
          {hasRetainedSong && (
            <>
              <button
                type="button"
                disabled={exporting !== null}
                title="Render the retained Groovebox song through its mastered stereo bus"
                onClick={onExportSong}
              >
                Song WAV
              </button>
              <button
                type="button"
                disabled={exporting !== null}
                title="Preview or export the retained song as one pre-master WAV per voice"
                onClick={onReviewSongStems}
              >
                Song stems
              </button>
            </>
          )}
        </HeaderMenu>
      </div>

      <div className="rk-group rk-group-end" role="group" aria-label="Guide and sequencer">
        <button
          type="button"
          className="rk-help-trigger"
          onClick={onHelp}
          aria-label="Open help"
          aria-keyshortcuts="?"
          title="Help (?)"
        >
          ? Help
        </button>

        {sequencerBlocked ? (
          <span
            className="rk-away rk-away-disabled"
            title="This sequencer build cannot safely open the retained future song"
          >
            Sequencer unavailable
          </span>
        ) : (
          <a className="rk-away" href="./index.html" onClick={onSequencer} title={sequencerTitle}>
            Sequencer →
          </a>
        )}
      </div>
    </header>
  )
}
