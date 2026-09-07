import type { Patch } from '@driftbox/rack'
import { freshName, savePatch } from './library.js'
import { useRack } from './store.js'

/** Never replace an unsaved rack with a lesson unless its recovery copy was written successfully. */
export function loadLessonSetup(patch: Patch, lesson: string): string | null {
  const current = useRack.getState()
  if (current.patch.modules.length > 0) {
    const backup = freshName(`Before lesson · ${current.name ?? 'Untitled rack'}`)
    if (!savePatch(backup, current.patch)) {
      return 'Could not save your current rack. Export it from the patch browser first, or use this rack for the lesson.'
    }
  }
  current.setRunning(false)
  current.setAutomating(false)
  current.load(patch)
  current.setName(`Lesson · ${lesson}`)
  if (current.flipped) current.flip()
  return null
}
