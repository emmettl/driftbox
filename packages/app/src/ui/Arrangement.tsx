import { chainBarAt, chainPositionAt, songBars, type ClipSlot } from '@driftbox/engine'
import { useBox } from '../store'
import { Panel } from './Panel'
import { usePlayhead } from './usePlayhead'

// The song, as a strip of sections.
//
// Each entry is a pattern and a number of bars, which is how people actually describe an
// arrangement — "eight of the quiet one, then four of the chorus". The alternative, a
// flat list of one entry per bar, means scrolling past eight identical cards and editing
// all of them every time you change your mind about a section's length.
//
// The playing entry is highlighted, and it counts through its own repeat, so at a glance
// you can see both where you are in the song and how much of this section is left.

export function Arrangement() {
  const song = useBox((s) => s.song)
  const editing = useBox((s) => s.editing)
  const view = useBox((s) => s.view)
  const selectedBass = useBox((s) => s.selectedBass)
  const setEditing = useBox((s) => s.setEditing)
  const appendChain = useBox((s) => s.appendChain)
  const removeChain = useBox((s) => s.removeChain)
  const setChainRepeat = useBox((s) => s.setChainRepeat)
  const setChainClip = useBox((s) => s.setChainClip)
  const moveChain = useBox((s) => s.moveChain)
  const loop = useBox((s) => s.loop)
  const startAtBar = useBox((s) => s.startAtBar)
  const toggleSectionLoop = useBox((s) => s.toggleSectionLoop)

  const playhead = usePlayhead()
  const playing = playhead ? chainPositionAt(song, playhead.bar) : undefined
  const bars = songBars(song)
  const slot: ClipSlot = view === 'bass' ? (selectedBass as ClipSlot) : view
  const slotLabel =
    slot === 'tr808' ? '808' : slot === 'tr909' ? '909' : slot === '303.a' ? '303 A' : '303 B'

  return (
    <Panel
      id="song"
      className="arrangement"
      title="Song"
      aside={
        <span className="arrangement-count">
          {bars} {bars === 1 ? 'bar' : 'bars'}
          {playing ? ` · playing ${playing.index + 1}/${song.chain.length}` : ''}
        </span>
      }
    >

      <div className="chain">
        {song.chain.map((step, index) => {
          const live = playing?.index === index
          const clip = step.clips?.[slot] ?? step.pattern
          const startsAt = chainBarAt(song, index)
          const looping = loop?.start === startsAt && loop.bars === step.repeat
          return (
            <div
              key={index}
              className={`chain-step${live ? ' live' : ''}${
                clip === editing ? ' editing' : ''
              }${looping ? ' looping' : ''}`}
            >
              <div className="chain-head">
                <button
                  className="chain-nudge"
                  onClick={() => moveChain(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move section ${index + 1} earlier`}
                >
                  ‹
                </button>
                {/* A select rather than a click-to-cycle: an arrangement with six
                    patterns to choose from is a picker, not a toggle. It controls the
                    machine currently on screen; the other three clips stay untouched. */}
                <span className="chain-slot">{slotLabel}</span>
                <select
                  value={clip}
                  onChange={(e) => setChainClip(index, slot, e.target.value)}
                  aria-label={`Section ${index + 1} ${slotLabel} pattern`}
                >
                  {song.patterns.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  className="chain-nudge"
                  onClick={() => moveChain(index, 1)}
                  disabled={index === song.chain.length - 1}
                  aria-label={`Move section ${index + 1} later`}
                >
                  ›
                </button>
              </div>

              <div className="chain-foot">
                <button
                  className="chain-nudge"
                  onClick={() => setChainRepeat(index, step.repeat - 1)}
                  aria-label={`Section ${index + 1} fewer bars`}
                >
                  −
                </button>
                <span className="chain-bars">
                  {/* Counting through the repeat while it plays, so a long section shows
                      how much of itself is left rather than just sitting there lit. */}
                  {live ? `${playing.barWithin + 1}/${step.repeat}` : `${step.repeat}`}
                </span>
                <button
                  className="chain-nudge"
                  onClick={() => setChainRepeat(index, step.repeat + 1)}
                  aria-label={`Section ${index + 1} more bars`}
                >
                  +
                </button>
                <button
                  className="chain-nudge chain-drop"
                  onClick={() => removeChain(index)}
                  aria-label={`Remove section ${index + 1}`}
                >
                  ×
                </button>
              </div>

              <div className="chain-transport">
                <button
                  className="chain-edit"
                  onClick={() => setEditing(clip)}
                  title={`Edit this section's ${slotLabel} clip`}
                >
                  edit
                </button>
                <button
                  className="chain-edit"
                  onClick={() => startAtBar(startsAt)}
                  title={`Play from section ${index + 1}`}
                  aria-label={`Play from section ${index + 1}`}
                >
                  ▶
                </button>
                <button
                  className={`chain-edit${looping ? ' on' : ''}`}
                  onClick={() => toggleSectionLoop(index)}
                  title={`Loop section ${index + 1}`}
                  aria-label={`Loop section ${index + 1}`}
                  aria-pressed={looping}
                >
                  loop
                </button>
              </div>
            </div>
          )
        })}

        <button
          className="chain-add"
          onClick={() => appendChain(editing || song.patterns[0]?.id)}
          title="Add the pattern you are editing to the end of the song"
          disabled={song.patterns.length === 0}
        >
          +
        </button>
      </div>

      {song.chain.length === 0 && (
        // Not an error state — an empty arrangement still plays the first pattern, which
        // is what you want while you are building one.
        <p className="arrangement-empty">
          No arrangement — the first pattern loops. Press + to start one.
        </p>
      )}
    </Panel>
  )
}
