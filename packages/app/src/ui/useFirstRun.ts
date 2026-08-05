import { useCallback, useEffect, useState } from 'react'

// What this browser has already worked out.
//
// The beacons exist to answer "what do I do next", and that question stops being asked
// after you have done it once. A hint that keeps arriving after you have learnt the thing
// is not a hint, it is a fault — so each one is recorded the first time it happens and
// never shown again on this machine.
//
// Kept apart from the song autosave deliberately: this is about the person, not the music,
// and resetting the song should not make the app start explaining itself again.

// `toured` is the rack's, and belongs in the same box for the reason above: whether somebody has been
// offered the guided tour is a fact about them, not about the patch open in front of them. It records the
// *offer* rather than a finished tour — declining one is knowing about it, and being asked again every
// time you open the rack is the failure this file exists to prevent.
export type Lesson = 'played' | 'vibed' | 'toured'

const KEY = 'driftbox.learnt.v1'

function read(): Lesson[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed.filter((v) => typeof v === 'string') as Lesson[]) : []
  } catch {
    // Private browsing, a full quota, or somebody's junk under our key. Never knowing is
    // better than never rendering.
    return []
  }
}

export function useFirstRun(): [Set<Lesson>, (lesson: Lesson) => void] {
  const [learnt, setLearnt] = useState<Set<Lesson>>(() => new Set(read()))

  const learn = useCallback((lesson: Lesson) => {
    setLearnt((current) => {
      if (current.has(lesson)) return current
      const next = new Set(current).add(lesson)
      try {
        localStorage.setItem(KEY, JSON.stringify([...next]))
      } catch {
        // Remembering for this session only is a fine outcome.
      }
      return next
    })
  }, [])

  return [learnt, learn]
}

/**
 * Whether a media query holds, kept live.
 *
 * The console beacons are for a mouse and a wide window. On a phone the console is a
 * cramped thing you reach by tapping edit — you already know where the buttons are,
 * because you just came from the button next to them.
 */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )

  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)
    onChange()
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])

  return matches
}
