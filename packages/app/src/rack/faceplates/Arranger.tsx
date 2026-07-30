import { ARRANGER_SECTIONS } from '@driftbox/rack'
import { useRef } from 'react'
import { ParamControl } from '../ParamControl.js'
import { useRack } from '../store.js'
import type { FaceplateProps } from './types.js'

// The song, laid out so you can read it.
//
// The module works with no faceplate at all — sections live in `data`, and a patch that ships an
// arrangement plays it whether or not anything can draw it. But an arrangement you cannot see is a
// recording, which is the same thing that was wrong with a Tracker you could not type into. **The point
// of a song here is that you can see where it goes and change your mind while it plays**, so the panel is
// the module as far as anybody using it is concerned.
//
// **One row per section, all sixteen at once, in two columns of eight.** Sixteen is the ceiling the module
// sets precisely so this fits, and the alternative — a scrolling list, or a page per eight — hides the
// shape of the song, which is the one thing the panel exists to show. An intro, four eights and an outro
// should be legible in a glance without operating anything. Sixteen stacked rows would make this the
// tallest module in the rack by half again; two columns of eight put it at the Combinator's height, and a
// song reads down the left then continues down the right.
//
// **Sections past the length are drawn, dimmed, not deleted.** Shortening a song to six sections when
// eight are written should be as reversible as turning a knob back. Same rule the Tracker follows when a
// pattern shortens, and the same rule the compiler follows for a module type it does not recognise.
//
// Two numbers per row and both are dragged rather than typed: pattern, and how many bars it lasts. Typing
// would need a keyboard, a commit gesture and a validation story; a drag is the gesture already used by
// every knob and every Tracker cell, and it works on a phone.

/** How far the pointer travels for one step of either number. Matches the Tracker's cells. */
const PIXELS = 4

/** The bars a fresh section lasts. Four is a phrase, and a song of four-bar sections is a song. */
const DEFAULT_BARS = 4

export function Arranger({ def, module, value, onChange, routed }: FaceplateProps) {
  const setData = useRack((s) => s.setData)
  /** Where a drag started, so the number follows the pointer rather than jumping to it. */
  const drag = useRef<{ slot: string; at: number; from: number; y: number } | null>(null)

  const param = (id: string) => def.params.find((p) => p.id === id)!
  const length = Math.round(value('length'))

  // Straight off the prop, which the Chassis looks up out of the live patch on every render — so this is
  // as current as anything the store could hand back, and it costs no subscription. The Tracker reaches
  // into the store for the same data; that is the older way round and it is only still there because
  // nothing has needed to change it.
  const stored = module.data
  const patterns = stored?.patterns ?? []
  const repeats = stored?.repeats ?? []

  /**
   * Write one number of one section.
   *
   * Padded to the full sixteen rather than to `length`, so a section written past the end of the array
   * lands where the row that was clicked says it does. Padding `repeats` with the default rather than with
   * zero, because a row that reads "4" and lasts one bar is a lie the panel is telling.
   */
  const write = (slot: string, at: number, next: number) => {
    const values = [...(stored?.[slot] ?? [])]
    while (values.length < ARRANGER_SECTIONS) values.push(slot === 'repeats' ? DEFAULT_BARS : 0)
    values[at] = next
    setData(module.id, slot, values)
  }

  /** A cell: shows a number, drags to change it. Identical gesture on both columns. */
  const cell = (slot: string, at: number, held: number, min: number, max: number, label: string) => (
    <button
      type="button"
      className="rk-song-cell"
      aria-label={`Section ${at + 1} ${label}, ${held}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { slot, at, from: held, y: event.clientY }
      }}
      onPointerMove={(event) => {
        const d = drag.current
        if (!d || d.slot !== slot || d.at !== at) return
        const moved = Math.round((d.y - event.clientY) / PIXELS)
        if (moved === 0) return
        const next = Math.max(min, Math.min(max, d.from + moved))
        if (next !== held) write(slot, at, next)
      }}
      onPointerUp={(event) => {
        const d = drag.current
        drag.current = null
        // A press that did not move is a click, and on the pattern column a click steps to the next
        // pattern and wraps. Worked out on pointerup rather than with an onClick, because onClick fires
        // after a drag too and would undo what the drag had just set — the Tracker learned that first.
        if (!d || Math.abs(d.y - event.clientY) >= PIXELS) return
        if (slot === 'patterns') write(slot, at, held >= max ? min : held + 1)
      }}
    >
      {held}
    </button>
  )

  return (
    <>
      <header className="rk-title">
        <span className="rk-name">Arranger</span>
        {/* How long the song is, and only that. The section count is on the knob already and legible from
            the rows that are not dimmed, whereas the total in bars is the one number you cannot get by
            looking — and the title strip is short, because the reorder and remove buttons sit in it. */}
        <span className="rk-ports">{songBars(repeats, length)} bars</span>
      </header>

      <div className="rk-controls">
        <ParamControl
          def={param('length')}
          value={value('length')}
          onChange={(v) => onChange('length', v)}
          routed={routed?.('length')}
        />
      </div>

      <div className="rk-song">
        {[0, 1].map((column) => (
          // Two columns, each with its own heading. Headed because two bare numbers side by side do not
          // say which is the pattern and which is the count, and a wrong guess here is a song that plays
          // pattern 4 for one bar when you meant pattern 1 for four.
          <div key={column} className="rk-song-col">
            <div className="rk-song-head">
              <span className="rk-song-at" />
              <span>Ptn</span>
              <span>Bars</span>
            </div>
            {Array.from({ length: ARRANGER_SECTIONS / 2 }, (_, row) => {
              const at = column * (ARRANGER_SECTIONS / 2) + row
              const pattern = Math.round(patterns[at] ?? 0)
              const count = Math.max(1, Math.round(repeats[at] ?? DEFAULT_BARS))
              const used = at < length
              return (
                <div key={at} className={used ? 'rk-song-row' : 'rk-song-row rk-song-past'}>
                  <span className="rk-song-at">{at + 1}</span>
                  {cell('patterns', at, pattern, 0, 7, 'pattern')}
                  {cell('repeats', at, count, 1, 64, 'bars')}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}

/** How long the song is, which is the number you actually want when you are looking at it. */
function songBars(repeats: number[], length: number): number {
  let total = 0
  for (let at = 0; at < length; at++) total += Math.max(1, Math.round(repeats[at] ?? DEFAULT_BARS))
  return total
}
