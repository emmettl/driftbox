import { BASS_VOICES, voiceById } from '@driftbox/engine'
import { useState } from 'react'
import { useBox } from '../store'

// Focused pattern operations. ReBirth hid these in the Edit menu; putting them beside
// pattern length makes the scope visible before an operation lands. Rotating may target
// one lane or the whole machine on screen. Randomise and alter stay lane-scoped because
// replacing an entire kit by accident is too large a gesture for a small button.

export function PatternTools() {
  const view = useBox((state) => state.view)
  const selectedVoice = useBox((state) => state.selectedVoice)
  const selectedBass = useBox((state) => state.selectedBass)
  const rotateSelection = useBox((state) => state.rotateSelection)
  const randomizeSelection = useBox((state) => state.randomizeSelection)
  const alterSelection = useBox((state) => state.alterSelection)
  const transposeSelectedBass = useBox((state) => state.transposeSelectedBass)
  const flamMode = useBox((state) => state.flamMode)
  const toggleFlamMode = useBox((state) => state.toggleFlamMode)
  const flamWidth = useBox((state) => state.song.kit.flam ?? 0.4)
  const setFlamWidth = useBox((state) => state.setFlamWidth)
  const [all, setAll] = useState(false)

  const target =
    view === 'bass'
      ? BASS_VOICES.find((voice) => voice.id === selectedBass)?.name
      : voiceById(selectedVoice)?.name
  const machine = view === 'bass' ? 'both 303s' : view === 'tr909' ? 'whole 909' : 'whole 808'

  return (
    <div className="pattern-tools" aria-label="Pattern transforms">
      <span className="pattern-tools-target">{target ?? 'lane'}</span>
      <button
        className={`ghost${all ? ' on' : ''}`}
        onClick={() => setAll((value) => !value)}
        title={`Rotate ${all ? machine : 'only the selected lane'}`}
        aria-pressed={all}
      >
        {all ? 'all' : 'lane'}
      </button>
      {view === 'tr909' && (
        <button
          className={`ghost${flamMode ? ' on' : ''}`}
          onClick={toggleFlamMode}
          title="Program a second, closely spaced strike on 909 steps"
          aria-pressed={flamMode}
        >
          flam
        </button>
      )}
      <button
        className="ghost pattern-arrow"
        onClick={() => rotateSelection(-1, all)}
        title={`Rotate ${all ? machine : target} one step left`}
        aria-label="Rotate left"
      >
        ←
      </button>
      <button
        className="ghost pattern-arrow"
        onClick={() => rotateSelection(1, all)}
        title={`Rotate ${all ? machine : target} one step right`}
        aria-label="Rotate right"
      >
        →
      </button>
      {view === 'tr909' && flamMode ? (
        <input
          className="flam-width"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={flamWidth}
          onChange={(event) => setFlamWidth(Number(event.target.value))}
          aria-label="Flam width"
          title="Space between the two 909 strikes"
        />
      ) : (
        <>
          <button
            className="ghost"
            onClick={() => {
              if (confirm(`Randomise ${target}? This replaces that lane.`)) randomizeSelection()
            }}
            title={`Create a new random ${target} lane`}
          >
            random
          </button>
          <button
            className="ghost"
            onClick={() => {
              if (confirm(`Alter ${target}? This rearranges its existing material.`)) alterSelection()
            }}
            title={`Rearrange ${target} without changing the amount of material`}
          >
            alter
          </button>
        </>
      )}
      {view === 'bass' && (
        <>
          <button
            className="ghost pattern-arrow"
            onClick={() => transposeSelectedBass(-1)}
            title={`Transpose ${target} down one semitone`}
            aria-label="Transpose down"
          >
            −
          </button>
          <button
            className="ghost pattern-arrow"
            onClick={() => transposeSelectedBass(1)}
            title={`Transpose ${target} up one semitone`}
            aria-label="Transpose up"
          >
            +
          </button>
        </>
      )}
    </div>
  )
}
