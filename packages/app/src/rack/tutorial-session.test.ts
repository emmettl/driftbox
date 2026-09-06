import { beforeEach, expect, it, vi } from 'vitest'
import { patchPresetById } from '@driftbox/rack'
import { savePatch } from './library.js'
import { useRack } from './store.js'
import { loadLessonSetup } from './tutorial-session.js'
import { lessonSetup } from './tutorials.js'

vi.mock('./library.js', () => ({
  freshName: (name: string) => `${name} 2`,
  savePatch: vi.fn(() => true),
}))

beforeEach(() => {
  vi.mocked(savePatch).mockReset().mockReturnValue(true)
  useRack.setState({ patch: patchPresetById('first-light')!.build(), name: 'My keys', running: true, automating: true, flipped: true })
})

it('saves a separate recovery copy before replacing the current rack', () => {
  const before = useRack.getState().patch
  const setup = lessonSetup('first-sound')
  expect(loadLessonSetup(setup, 'First sound')).toBeNull()
  expect(savePatch).toHaveBeenCalledWith('Before lesson · My keys 2', before)
  expect(useRack.getState().patch).toEqual(setup)
  expect(useRack.getState()).toMatchObject({ name: 'Lesson · First sound', running: false, automating: false, flipped: false })
})

it('keeps the document and performance unchanged when recovery storage fails', () => {
  vi.mocked(savePatch).mockReturnValue(false)
  const before = useRack.getState()
  expect(loadLessonSetup(lessonSetup('sequence-it'), 'Sequence')).toContain('Could not save')
  expect(useRack.getState()).toBe(before)
})
