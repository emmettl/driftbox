import { SCALE_PLAYER_CUSTOM_NOTES } from '@driftbox/rack'

// Mirrors the preset order declared by SCALE_PLAYER_MODULE. The processor must keep its table inside the
// serialised class, while the faceplate needs the same display data on the host; this small explicit table
// is preferable to making either side depend on worklet implementation state.
const PRESETS = [
  [0, 2, 4, 5, 7, 9, 11],
  [0, 2, 3, 5, 7, 8, 10],
  [0, 2, 4, 6, 7, 9, 11],
  [0, 2, 4, 5, 7, 9, 10],
  [0, 1, 4, 5, 7, 8, 10],
  [0, 2, 3, 5, 7, 9, 10],
  [0, 1, 3, 5, 7, 8, 10],
  [0, 2, 3, 5, 7, 8, 11],
  [0, 2, 3, 5, 7, 9, 11],
  [0, 2, 4, 7, 9],
  [0, 3, 5, 7, 10],
  [0, 1, 5, 7, 8],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
] as const

export function scalePlayerMask(scale: number, custom: readonly number[] = []): number[] {
  const which = Math.max(0, Math.min(13, Math.round(scale)))
  const degrees: readonly number[] = which < PRESETS.length
    ? PRESETS[which]
    : custom.some((enabled) => enabled >= 0.5)
      ? custom.flatMap((enabled, note) => enabled >= 0.5 ? [note] : [])
      : PRESETS[0]
  return Array.from(
    { length: SCALE_PLAYER_CUSTOM_NOTES },
    (_, note) => degrees.includes(note) ? 1 : 0,
  )
}
