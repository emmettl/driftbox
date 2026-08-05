import type { PatchCompatibility } from '@driftbox/rack'

// What the rack says about a document it did not author.
//
// Rack mode is a strict superset of the sequencer, and a person who arrived here from a song is owed a
// straight answer to two questions: is my song still intact, and what happens if I go back? The three
// sentences below are that answer, and they differ by compatibility state — so they are a function of the
// state rather than a nest of ternaries inside a paragraph.

export interface DocumentNotice {
  /** The compatibility state, shown as the notice's own label. */
  compatibility: PatchCompatibility
  /** What is retained, in numbers where there are numbers to give. */
  retained: string
  /** What happens next: how it plays here, and what returning to the sequencer costs. */
  guidance: string
}

/** The retained song, reduced to the two facts the notice quotes. Null when this build cannot decode it. */
export interface RetainedSongSummary {
  patterns: number
  bpm: number
}

/**
 * The notice for a document, or null when there is nothing to say.
 *
 * A rack-native patch is the ordinary case and gets no notice at all: a banner above every patch somebody
 * built here would be a permanent apology for nothing.
 */
export function documentNotice(
  compatibility: PatchCompatibility,
  song: RetainedSongSummary | null,
): DocumentNotice | null {
  if (compatibility === 'rack-native') return null

  return {
    compatibility,
    retained: song
      ? `${song.patterns} patterns at ${song.bpm} BPM retained exactly.`
      : 'A song from a newer groovebox build is retained exactly but cannot be edited here.',
    guidance: song
      ? compatibility === 'rack-extended'
        ? 'The retained song plays here; cabled machines run through the Groovebox source, and “Sequencer →” keeps those rack additions saved here.'
        : 'The retained song plays through its original mix; patch a Groovebox output to route that machine through the rack. “Sequencer →” returns without loss.'
      : 'This build will preserve it, but will not send it to a sequencer that cannot decode it.',
  }
}

/**
 * The title on the “Sequencer →” link, which is the same promise made in advance.
 *
 * `embedded` is whether the document carries a retained song envelope at all — deliberately not whether
 * *this* build can decode it. A song from a newer build still came from a sequencer, and the link still
 * needs to say what pressing it does.
 */
export function sequencerTitle(
  compatibility: PatchCompatibility,
  embedded: boolean,
): string | undefined {
  if (!embedded) return undefined
  return compatibility === 'rack-extended'
    ? 'Open the retained song; rack-only additions stay saved in rack mode'
    : 'Return to the sequencer with the retained song'
}

/**
 * The confirmation shown before leaving a rack-extended document for the sequencer.
 *
 * Null when nothing needs confirming. Leaving is lossless for a groovebox-compatible patch, and a dialog
 * asking somebody to accept a cost they are not paying teaches them to dismiss the one that matters.
 */
export function leavingWarning(compatibility: PatchCompatibility): string | null {
  return compatibility === 'rack-extended'
    ? 'This opens only the retained groovebox song. Your rack modules, cables and other rack-only changes stay saved in rack mode. Continue?'
    : null
}
