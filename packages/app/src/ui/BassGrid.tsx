import { useRef } from 'react'
import { BASS_VOICES, bassStepAt, type BassStep } from '@driftbox/engine'
import { useBox } from '../store'
import { usePlayhead } from './usePlayhead'

// The 303 grid.
//
// Three rows per synth — note, accent, slide — rather than one row of cells that have
// to express all three at once. That is not a compromise, it is what the hardware does:
// you write the pitches, then you go back over the bar switching accent and slide on
// per step. Keeping the three separate means each row is a picture of one decision, and
// the accent and slide rows read at a glance the way the drum grid does.
//
// Pitch is a vertical drag on the note cell, the same gesture as a knob, because
// sixteen cells each needing two octaves of range is the one place a grid of buttons
// genuinely cannot go.

const LOW = 0
const HIGH = 24

/** Note names relative to the synth's root, which is an A. The octave marks are what
 *  stop a two-octave range reading as twelve interchangeable letters. */
const NAMES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#']

function noteName(semitones: number): string {
  const name = NAMES[((semitones % 12) + 12) % 12]
  const octave = Math.floor(semitones / 12)
  return octave === 0 ? name : `${name}${octave === 1 ? '′' : '″'}`
}

const clampNote = (n: number) => Math.max(LOW, Math.min(HIGH, n))

interface CellProps {
  step: BassStep
  live: boolean
  downbeat: boolean
  label: string
  onChange: (next: BassStep) => void
  onPreview: (next: BassStep) => void
}

function NoteCell({ step, live, downbeat, label, onChange, onPreview }: CellProps) {
  // A drag that never moved is a click. Tracked here rather than by listening for both
  // events, because a pointer that moves one pixel while you click should still toggle
  // the step rather than silently retuning it.
  const drag = useRef<{ y: number; from: number; moved: boolean } | null>(null)

  const classes = ['step', 'bass-note', downbeat ? 'downbeat' : '', live ? 'live' : '']
  if (step.note !== null) classes.push(step.accent ? 'accent' : 'on')

  return (
    <button
      className={classes.filter(Boolean).join(' ')}
      aria-label={label}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { y: event.clientY, from: step.note ?? 0, moved: false }
      }}
      onPointerMove={(event) => {
        const state = drag.current
        if (!state || step.note === null) return
        const moved = Math.round((state.y - event.clientY) / 7)
        if (moved === 0) return
        state.moved = true
        const next = clampNote(state.from + moved)
        if (next !== step.note) onChange({ ...step, note: next })
      }}
      onPointerUp={(event) => {
        const state = drag.current
        drag.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
        if (!state || state.moved) return
        // A plain click turns the step on and off. New notes come in at the root, which
        // is almost always where you want to start before dragging it somewhere.
        const next: BassStep =
          step.note === null ? { ...step, note: 0 } : { ...step, note: null }
        onChange(next)
        if (next.note !== null) onPreview(next)
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
      onKeyDown={(event) => {
        if (step.note === null) return
        const by = event.shiftKey ? 12 : 1
        if (event.key === 'ArrowUp') onChange({ ...step, note: clampNote(step.note + by) })
        if (event.key === 'ArrowDown') onChange({ ...step, note: clampNote(step.note - by) })
      }}
    >
      {step.note === null ? '' : noteName(step.note)}
    </button>
  )
}

export function BassGrid() {
  const song = useBox((s) => s.song)
  const editing = useBox((s) => s.editing)
  const selectedBass = useBox((s) => s.selectedBass)
  const editBassStep = useBox((s) => s.editBassStep)
  const selectBass = useBox((s) => s.selectBass)
  const auditionBass = useBox((s) => s.auditionBass)

  const playhead = usePlayhead()
  const pattern = song.patterns.find((p) => p.id === editing)
  if (!pattern) return null

  const playing = playhead
    ? song.chain.length === 0
      ? song.patterns[0]?.id
      : song.chain[playhead.bar % song.chain.length]
    : undefined
  const live = playing === editing ? playhead?.index : undefined

  return (
    <div className="grid bass-grid">
      {BASS_VOICES.map((voice) => {
        const steps = Array.from({ length: pattern.length }, (_, step) =>
          bassStepAt(pattern, voice.id, step),
        )
        const edit = (step: number, next: BassStep) => editBassStep(voice.id, step, next)

        return (
          <div
            key={voice.id}
            className={`bass-voice${voice.id === selectedBass ? ' selected' : ''}`}
            onPointerDown={() => selectBass(voice.id)}
          >
            {(['note', 'accent', 'slide'] as const).map((lane) => (
              <div key={lane} className="row">
                <span className="row-name bass-lane">
                  {lane === 'note' ? voice.name : lane}
                </span>
                <div
                  className="row-steps"
                  style={{
                    gridTemplateColumns: `repeat(${pattern.length}, minmax(0, 1fr))`,
                  }}
                >
                  {steps.map((step, index) =>
                    lane === 'note' ? (
                      <NoteCell
                        key={index}
                        step={step}
                        live={live === index}
                        downbeat={index % 4 === 0}
                        label={`${voice.name} step ${index + 1} note`}
                        onChange={(next) => edit(index, next)}
                        onPreview={(next) => auditionBass(voice.id, next)}
                      />
                    ) : (
                      <button
                        key={index}
                        className={[
                          'step',
                          `bass-${lane}`,
                          index % 4 === 0 ? 'downbeat' : '',
                          step[lane] ? 'on' : '',
                          // Only meaningful on a step that has a note. Dimmed rather
                          // than disabled, so the flag survives you clearing a note and
                          // putting it back.
                          step.note === null ? 'idle' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        aria-label={`${voice.name} step ${index + 1} ${lane}`}
                        aria-pressed={step[lane]}
                        onClick={() => edit(index, { ...step, [lane]: !step[lane] })}
                      />
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
