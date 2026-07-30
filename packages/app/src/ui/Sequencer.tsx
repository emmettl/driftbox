import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { ALL_VOICES, flamAt, stepAt, type StepValue } from '@driftbox/engine'
import { useBox } from '../store'
import { useLiveStep } from './useLiveStep'

// The step grid. Sixteen buttons a row, grouped in fours, because that grouping is
// what makes a pattern readable at a glance — and readability is the entire ergonomic
// advantage a step sequencer has over a piano roll.

export function Sequencer() {
  const song = useBox((s) => s.song)
  const view = useBox((s) => s.view)
  const editing = useBox((s) => s.editing)
  const selectedVoice = useBox((s) => s.selectedVoice)
  const toggleStep = useBox((s) => s.toggleStep)
  const setDrumStep = useBox((s) => s.setDrumStep)
  const flamMode = useBox((s) => s.flamMode)
  const toggleFlamStep = useBox((s) => s.toggleFlamStep)
  const audition = useBox((s) => s.audition)
  const selectVoice = useBox((s) => s.selectVoice)

  const live = useLiveStep()
  const pattern = song.patterns.find((p) => p.id === editing)
  const voices = ALL_VOICES.filter((v) => v.machine === view)
  const paint = useRef<{
    pointer: number
    voiceId: string
    start: number
    last: number
    value: StepValue
    moved: boolean
  } | null>(null)
  // Pointer-up is followed by click. A drag has already written its cells, so that click
  // must not cycle the last one a second time.
  const suppressClick = useRef(false)

  useEffect(() => {
    const finish = (event: PointerEvent) => {
      if (paint.current?.pointer !== event.pointerId) return
      suppressClick.current = paint.current.moved
      paint.current = null
    }
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => {
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  }, [])

  if (!pattern) return null

  const continuePaint = (event: ReactPointerEvent) => {
    const stroke = paint.current
    if (!stroke || stroke.pointer !== event.pointerId) return
    // Touch pointers are implicitly captured by the first pad, so event.target stays on
    // that pad while the finger crosses the row. Hit-test the pointer position instead;
    // the same path then works for mouse, pen and touch.
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLButtonElement>('button[data-step]')
    if (!target || target.dataset.voice !== stroke.voiceId) return
    const step = Number(target.dataset.step)
    if (!Number.isInteger(step) || step === stroke.last) return

    if (!stroke.moved) setDrumStep(stroke.voiceId, stroke.start, stroke.value)
    setDrumStep(stroke.voiceId, step, stroke.value)
    stroke.last = step
    stroke.moved = true
  }

  return (
    <div className="grid" onPointerMove={continuePaint}>
      {/* The ruler. A row of ticks above the pads with the current one lit, so the cursor
          is legible on a pattern whose top rows happen to be empty — the pads alone only
          show a position where there is already something to light up. */}
      <div className="row ruler" aria-hidden="true">
        <span className="row-name" />
        <div
          className="row-steps"
          style={{ gridTemplateColumns: `repeat(${pattern.length}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: pattern.length }, (_, step) => (
            <span
              key={step}
              className={`tick${step % 4 === 0 ? ' downbeat' : ''}${live === step ? ' live' : ''}`}
            />
          ))}
        </div>
      </div>
      {voices.map((voice) => (
        <div
          key={voice.id}
          className={`row${voice.id === selectedVoice ? ' selected' : ''}`}
          onPointerDown={() => selectVoice(voice.id)}
        >
          <button
            className="row-name"
            onClick={() => audition(voice.id)}
            title={`Audition ${voice.name}`}
          >
            {voice.name}
          </button>
          <div
            className="row-steps"
            // Driven by the pattern rather than fixed at 16 in CSS, so a 15-step loop
            // still fills the row instead of leaving a gap where step 16 used to be.
            style={{ gridTemplateColumns: `repeat(${pattern.length}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: pattern.length }, (_, step) => {
              const value = stepAt(pattern, voice.id, step)
              const flam = view === 'tr909' && flamAt(pattern, voice.id, step)
              const classes = [
                'step',
                value === 1 ? 'on' : '',
                value === 2 ? 'accent' : '',
                flam ? 'flam' : '',
                step % 4 === 0 ? 'downbeat' : '',
                live === step ? 'live' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <button
                  key={step}
                  className={classes}
                  data-step={step}
                  data-voice={voice.id}
                  onPointerDown={(event) => {
                    if (view === 'tr909' && flamMode) {
                      paint.current = null
                      suppressClick.current = false
                      return
                    }
                    paint.current = {
                      pointer: event.pointerId,
                      voiceId: voice.id,
                      start: step,
                      last: step,
                      // Starting on an empty pad paints normal hits. Starting on either
                      // kind of hit erases, matching ReBirth's drag gesture.
                      value: value === 0 ? 1 : 0,
                      moved: false,
                    }
                    suppressClick.current = false
                  }}
                  onClick={() => {
                    if (suppressClick.current) {
                      suppressClick.current = false
                      return
                    }
                    if (view === 'tr909' && flamMode) toggleFlamStep(voice.id, step)
                    else toggleStep(voice.id, step)
                  }}
                  onDragStart={(event) => event.preventDefault()}
                  aria-label={`${voice.name} step ${step + 1}${flam ? ', flam' : ''}`}
                  aria-pressed={value !== 0}
                />
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
