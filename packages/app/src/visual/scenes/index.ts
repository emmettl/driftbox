import type { ReactElement } from 'react'
import { Lifeforms } from './Lifeforms'
import { Sunset } from './Sunset'
import { Wireframe } from './Wireframe'
import { Clouds } from './Clouds'
import { Cycles } from './Cycles'
import { Defcon } from './Defcon'
import { Saturn } from './Saturn'
import { Stillwater } from './Stillwater'
import { Trench } from './Trench'
import { Web } from './Web'

// The registry. Its own module because it is data rather than a component, and exporting
// both from one file breaks fast refresh.

export interface SceneInfo {
  id: string
  name: string
  Component: () => ReactElement
  /**
   * What colour the filter pad's cursor and its trail should be, as `r, g, b`.
   *
   * The pad is drawn on a 2D canvas over the top of whichever scene is running, and it was
   * amber for all of them — which was chosen against a dark blue horizon and is simply the
   * wrong colour on a Tempest web that cycles through the whole spectrum, and actively bad
   * on a bright blue sky. A scene knows what it looks like; the pad does not.
   */
  accent: string
}

export const SCENES: SceneInfo[] = [
  { id: 'sunset', name: 'Sunset', Component: Sunset, accent: '255, 176, 46' /* the sun it is drawn over */ },
  { id: 'lifeforms', name: 'Lifeforms', Component: Lifeforms, accent: '255, 120, 220' /* picked out of the bodies */ },
  { id: 'wireframe', name: 'Wireframe', Component: Wireframe, accent: '95, 240, 208' /* the near end of the corridor */ },
  { id: 'web', name: 'Web', Component: Web, accent: '255, 255, 255' /* white, because the web is already every other colour */ },
  { id: 'trench', name: 'Trench', Component: Trench, accent: '255, 90, 70' /* the cannons */ },
  { id: 'water', name: 'Stillwater', Component: Stillwater, accent: '150, 205, 255' /* the crest of a ring */ },
  { id: 'saturn', name: 'Saturn', Component: Saturn, accent: '255, 220, 150' /* the cloud tops */ },
  { id: 'cycles', name: 'Light Cycles', Component: Cycles, accent: '95, 240, 255' /* the hero rides the blue one */ },
  { id: 'defcon', name: 'Defcon', Component: Defcon, accent: '255, 240, 120' /* neither side, so it reads as yours */ },
  { id: 'clouds', name: 'Clouds', Component: Clouds, accent: '60, 90, 150' /* dark, because everything else on this one is light */ },
]

export type SceneId = string

export function nextScene(current: SceneId): SceneId {
  const at = SCENES.findIndex((s) => s.id === current)
  return SCENES[(at + 1) % SCENES.length].id
}
