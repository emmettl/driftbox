import { transposeBassLine, type Pattern, type Song } from '@driftbox/engine'
import {
  alterFocus,
  canPasteFocus,
  clearFocus,
  copyFocus,
  focusLabel,
  focusedName,
  pasteFocus,
  pasteTitle,
  randomizeFocus,
  rotateFocus,
  type Focus,
  type FocusClipboard,
} from './groovebox-focus.js'
import { sectionName, tapArmTitle } from './groovebox-format.js'

interface Props {
  song: Song
  pattern: Pattern
  focus: Focus
  selected: number
  tapRecording: boolean
  running: boolean
  flamMode: boolean
  setFlamMode: (next: (current: boolean) => boolean) => void
  setWholeMachine: (next: (current: boolean) => boolean) => void
  clipboard: FocusClipboard | null
  setClipboard: (next: FocusClipboard) => void
  /** Point the store's tap target at this focus, then arm or disarm recording. */
  armTap: () => void
  setFlamWidth: (value: number) => void
  save: (next: Pattern, discrete?: boolean) => void
}

/**
 * The transform row and the clipboard row: everything that rewrites the focused material at once.
 *
 * Both rows lead with the focus label, because every button in them acts on something the grid above
 * does not show — a rotation of eleven lanes looks identical to a rotation of one until you scroll to a
 * lane you were not watching. The label is the confirmation, so it is drawn from the same `focusLabel`
 * the edits themselves use rather than assembled separately here.
 */
export function GrooveboxTools({
  song,
  pattern,
  focus,
  selected,
  tapRecording,
  running,
  flamMode,
  setFlamMode,
  setWholeMachine,
  clipboard,
  setClipboard,
  armTap,
  setFlamWidth,
  save,
}: Props) {
  const { bass, section, voice, wholeMachine } = focus
  const label = focusLabel(focus)
  const focused = focusedName(focus)
  const canPaste = canPasteFocus(clipboard, focus)

  const copy = () => {
    const copied = copyFocus(pattern, focus)
    if (copied) setClipboard(copied)
    return copied
  }

  return (
    <>
      <div className="rk-groovebox-tools" aria-label="Groovebox pattern transforms">
        <strong>{label}</strong>
        <button
          type="button"
          className="rk-groovebox-tap"
          aria-pressed={tapRecording}
          aria-label={
            tapRecording ? 'Disarm Groovebox tap recording' : 'Arm Groovebox tap recording'
          }
          title={tapArmTitle({
            armed: tapRecording,
            bass,
            running,
            target: focused,
            step: selected,
          })}
          onClick={armTap}
        >
          <span aria-hidden="true">●</span> tap
        </button>
        {!bass && (
          <button
            type="button"
            aria-pressed={wholeMachine}
            onClick={() => setWholeMachine((current) => !current)}
            title={`Rotate ${wholeMachine ? `only ${voice?.name ?? 'the selected lane'}` : `the whole ${sectionName(section)}`}`}
          >
            {wholeMachine ? 'all' : 'lane'}
          </button>
        )}
        {section === 'tr909' && (
          <button
            type="button"
            aria-pressed={flamMode}
            onClick={() => setFlamMode((current) => !current)}
            title="Program a second, closely spaced strike on 909 steps"
          >
            flam
          </button>
        )}
        <button
          type="button"
          onClick={() => save(rotateFocus(pattern, focus, -1), true)}
          aria-label={`Rotate ${label} left`}
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => save(rotateFocus(pattern, focus, 1), true)}
          aria-label={`Rotate ${label} right`}
        >
          →
        </button>
        {section === 'tr909' && flamMode ? (
          <label>
            Flam width
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={song.kit.flam ?? 0.4}
              onChange={(event) => setFlamWidth(Number(event.target.value))}
              aria-label="Groovebox flam width"
            />
          </label>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Randomise ${focused}? This replaces that lane.`)) {
                  save(randomizeFocus(pattern, focus), true)
                }
              }}
            >
              random
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(`Alter ${focused}? This rearranges its existing material.`)
                ) {
                  save(alterFocus(pattern, focus), true)
                }
              }}
            >
              alter
            </button>
          </>
        )}
        {bass && (
          <>
            <button
              type="button"
              onClick={() => save(transposeBassLine(pattern, section, -1), true)}
              aria-label={`Transpose ${focused} down`}
            >
              −
            </button>
            <button
              type="button"
              onClick={() => save(transposeBassLine(pattern, section, 1), true)}
              aria-label={`Transpose ${focused} up`}
            >
              +
            </button>
          </>
        )}
      </div>

      <div className="rk-groovebox-clipboard" aria-label="Groovebox focused clipboard">
        <strong>{label}</strong>
        <button
          type="button"
          onClick={() => {
            if (copy()) save(clearFocus(pattern, focus), true)
          }}
          aria-label={`Cut ${label}`}
        >
          cut
        </button>
        <button type="button" onClick={copy} aria-label={`Copy ${label}`}>
          copy
        </button>
        <button
          type="button"
          disabled={!canPaste}
          onClick={() => save(pasteFocus(pattern, clipboard, focus), true)}
          aria-label={`Paste into ${label}`}
          title={pasteTitle(clipboard, focus)}
        >
          paste
        </button>
        <span aria-live="polite">
          {clipboard ? `${clipboard.label} copied` : 'clipboard empty'}
        </span>
      </div>
    </>
  )
}
