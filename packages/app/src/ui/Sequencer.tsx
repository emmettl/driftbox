import { ALL_VOICES, stepAt } from '@driftbox/engine'
import { useBox } from '../store'
import { usePlayhead } from './usePlayhead'

// The step grid. Sixteen buttons a row, grouped in fours, because that grouping is
// what makes a pattern readable at a glance — and readability is the entire ergonomic
// advantage a step sequencer has over a piano roll.

export function Sequencer() {
  const song = useBox((s) => s.song)
  const view = useBox((s) => s.view)
  const editing = useBox((s) => s.editing)
  const selectedVoice = useBox((s) => s.selectedVoice)
  const toggleStep = useBox((s) => s.toggleStep)
  const audition = useBox((s) => s.audition)
  const selectVoice = useBox((s) => s.selectVoice)

  const playhead = usePlayhead()
  const pattern = song.patterns.find((p) => p.id === editing)
  const voices = ALL_VOICES.filter((v) => v.machine === view)

  if (!pattern) return null

  // The light only follows the playhead when the pattern being edited is the one
  // actually sounding. Otherwise it would march across a pattern nobody is hearing.
  const playing = playhead
    ? song.chain.length === 0
      ? song.patterns[0]?.id
      : song.chain[playhead.bar % song.chain.length]
    : undefined
  const live = playing === editing ? playhead?.index : undefined

  return (
    <div className="grid">
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
              const classes = [
                'step',
                value === 1 ? 'on' : '',
                value === 2 ? 'accent' : '',
                step % 4 === 0 ? 'downbeat' : '',
                live === step ? 'live' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <button
                  key={step}
                  className={classes}
                  onClick={() => toggleStep(voice.id, step)}
                  aria-label={`${voice.name} step ${step + 1}`}
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
