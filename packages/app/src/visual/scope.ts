// Which meters exist, as data rather than as part of the component.
//
// Its own module for the same reason the scene registry is: a file that exports both a
// component and constants breaks fast refresh, and this is imported by the store, the
// stage and the editor panel as well as by the canvas that draws it.

export type ScopeMode = 'wave' | 'bars' | 'waterfall' | 'xy' | 'stereo' | 'vu' | 'off'

/** In the order the selector cycles them. Waveform first because it is the best default
 *  and the most diagnostic; off last, so you have seen the others before you reach it. */
export const SCOPE_MODES: ScopeMode[] = ['wave', 'bars', 'waterfall', 'xy', 'stereo', 'vu', 'off']

export const SCOPE_LABELS: Record<ScopeMode, string> = {
  wave: 'wave',
  bars: 'bars',
  waterfall: 'fall',
  xy: 'x/y',
  stereo: 'l/r',
  vu: 'vu',
  off: 'off',
}

/** The next mode round the loop. */
export function nextScope(mode: ScopeMode): ScopeMode {
  return SCOPE_MODES[(SCOPE_MODES.indexOf(mode) + 1) % SCOPE_MODES.length]
}
