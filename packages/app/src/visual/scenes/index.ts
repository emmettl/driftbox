import type { ReactElement } from 'react'
import { Lifeforms } from './Lifeforms'
import { Sunset } from './Sunset'
import { Wireframe } from './Wireframe'
import { Trench } from './Trench'
import { Web } from './Web'

// The registry. Its own module because it is data rather than a component, and exporting
// both from one file breaks fast refresh.

export interface SceneInfo {
  id: string
  name: string
  Component: () => ReactElement
}

export const SCENES: SceneInfo[] = [
  { id: 'sunset', name: 'Sunset', Component: Sunset },
  { id: 'lifeforms', name: 'Lifeforms', Component: Lifeforms },
  { id: 'wireframe', name: 'Wireframe', Component: Wireframe },
  { id: 'web', name: 'Web', Component: Web },
  { id: 'trench', name: 'Trench', Component: Trench },
]

export type SceneId = string

export function nextScene(current: SceneId): SceneId {
  const at = SCENES.findIndex((s) => s.id === current)
  return SCENES[(at + 1) % SCENES.length].id
}
