import { patternForBar, patternForClip, type ClipSlot, type Song } from '@driftbox/engine'
import { useBox } from '../store'
import { usePlayhead } from './usePlayhead'

/**
 * Which step of the pattern on screen is sounding right now, or null.
 *
 * This existed twice, inline and identical, in the drum grid and the bass grid — and it
 * was wrong in both, in the same two ways:
 *
 *   const playing = song.chain[playhead.bar % song.chain.length]
 *   const live = playing === editing ? playhead.index : undefined
 *
 * `song.chain[n]` is a `ChainStep` object, not a pattern id, so comparing it to a string
 * was false every time and the cursor never rendered at all — 176 step buttons, zero of
 * them ever lit. And the indexing treats each chain entry as one bar, ignoring `repeat`,
 * so even with the types right it would have pointed at the wrong section from the second
 * bar onward. `chainPositionAt` is the function that already knows how to walk a chain.
 *
 * Null when the pattern being edited is not the one playing: a cursor marching across a
 * pattern nobody can hear is worse than no cursor.
 *
 * The lookup is split out as a plain function because that is the half that was wrong and
 * the half a test can reach. TypeScript did not object to the original: `===` between a
 * union that includes `string` and a `string` is legal, so a `ChainStep` on the left of it
 * type-checks and is simply never equal.
 */
export function soundingPatternAt(
  song: Song,
  bar: number,
  slot?: ClipSlot,
): string | undefined {
  if (!slot) return patternForBar(song, bar)?.id
  return patternForClip(song, bar, slot)?.id
}

export function useLiveStep(): number | null {
  const song = useBox((s) => s.song)
  const editing = useBox((s) => s.editing)
  const view = useBox((s) => s.view)
  const selectedBass = useBox((s) => s.selectedBass)
  const playhead = usePlayhead()

  if (!playhead) return null
  const slot: ClipSlot = view === 'bass' ? (selectedBass as ClipSlot) : view
  return soundingPatternAt(song, playhead.bar, slot) === editing ? playhead.index : null
}
