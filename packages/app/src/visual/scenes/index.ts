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
  /**
   * How the pad's trail is drawn, when the default does not suit.
   *
   * `scale` multiplies its radius: a scene made of fine lines wants a small trail, and one
   * made of big soft shapes wants a big one or it disappears into them. `ring` draws it as
   * an expanding outline rather than a filled blob, which is the only thing that reads on
   * a bright scene — a dark blob on a bright sky looks like a smudge on the lens.
   */
  trail?: { scale?: number; ring?: boolean }
}

export const SCENES: SceneInfo[] = [
  // Accents are picked to CONTRAST with the scene, not to match it. Amber was chosen
  // against the sunset's own amber sun, which is exactly why it disappeared into it — and
  // it was then used on nine other scenes it had never been looked at over.
  { id: 'sunset', name: 'Sunset', Component: Sunset, accent: '120, 255, 230' },
  { id: 'lifeforms', name: 'Lifeforms', Component: Lifeforms, accent: '255, 255, 255', trail: { scale: 1.4 } },
  { id: 'wireframe', name: 'Wireframe', Component: Wireframe, accent: '255, 255, 255' },
  // White, because the web is already cycling through every other colour there is.
  { id: 'web', name: 'Web', Component: Web, accent: '255, 255, 255' },
  { id: 'trench', name: 'Trench', Component: Trench, accent: '120, 255, 210' },
  { id: 'water', name: 'Stillwater', Component: Stillwater, accent: '150, 220, 255', trail: { scale: 1.5 } },
  // Icy blue against a cream planet.
  { id: 'saturn', name: 'Saturn', Component: Saturn, accent: '150, 220, 255', trail: { scale: 1.5 } },
  // Small and white: this one is made of fine bright lines and a big soft blob buries them.
  { id: 'cycles', name: 'Light Cycles', Component: Cycles, accent: '255, 255, 255', trail: { scale: 0.7 } },
  // Near-white — neither green nor red, so the cursor reads as yours rather than a side's.
  { id: 'defcon', name: 'Defcon', Component: Defcon, accent: '255, 250, 200', trail: { scale: 0.8 } },
  // The only dark accent, and the only ring: a dark blob on a bright sky is a smudge on
  // the lens, whereas an outline reads as something drawn on top of it.
  { id: 'clouds', name: 'Clouds', Component: Clouds, accent: '40, 70, 130', trail: { scale: 1.8, ring: true } },
]

export type SceneId = string

export function nextScene(current: SceneId): SceneId {
  const at = SCENES.findIndex((s) => s.id === current)
  return SCENES[(at + 1) % SCENES.length].id
}
