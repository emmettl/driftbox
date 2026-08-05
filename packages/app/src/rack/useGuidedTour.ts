import { useCallback, useState } from 'react'
import { useFirstRun } from '../ui/useFirstRun.js'
import {
  finishedTours,
  finishTour,
  tutorialById,
  TUTORIALS,
  type Tutorial,
} from './tutorials.js'

/** What the help dialog needs to list a tour, with no idea what a rack patch is. */
export interface TourSummary {
  id: string
  name: string
  blurb: string
  minutes: number
  steps: number
  done: boolean
}

export interface GuidedTour {
  /** The tour running beside the rack, if any. */
  tour: Tutorial | null
  start: (id: string) => void
  close: () => void
  finish: (id: string) => void
  /** Whether the once-ever offer has been answered, either way. */
  offered: boolean
  /** Answer the offer without starting anything. */
  decline: () => void
  tutorials: TourSummary[]
}

/**
 * The guided tour running beside the rack, and which ones this browser has been through.
 *
 * `finishedTours` is read once. It is only ever written by finishing one, so re-reading storage on every
 * render would be a synchronous `localStorage` hit per frame for an answer that cannot have changed.
 */
export function useGuidedTour(): GuidedTour {
  const [tour, setTour] = useState<Tutorial | null>(null)
  const [toursDone, setToursDone] = useState<Set<string>>(() => finishedTours())
  const [learnt, learn] = useFirstRun()

  const start = useCallback(
    (id: string) => {
      // Starting one answers the offer as surely as declining does; it must not be asked again.
      learn('toured')
      setTour(tutorialById(id) ?? null)
    },
    [learn],
  )

  return {
    tour,
    start,
    close: useCallback(() => setTour(null), []),
    finish: useCallback((id: string) => setToursDone(finishTour(id)), []),
    offered: learnt.has('toured'),
    decline: useCallback(() => learn('toured'), [learn]),
    // Mapped down to plain fields: the guide is shared with the sequencer and must not learn what a rack
    // patch is. See `HelpTutorial`.
    tutorials: TUTORIALS.map((entry) => ({
      id: entry.id,
      name: entry.name,
      blurb: entry.blurb,
      minutes: entry.minutes,
      steps: entry.steps.length,
      done: toursDone.has(entry.id),
    })),
  }
}
