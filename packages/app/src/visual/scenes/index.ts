import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

// The registry. Its own module because it is data rather than a component, and exporting
// both from one file breaks fast refresh.

/**
 * One scene, fetched when something asks to render it.
 *
 * **The metadata stays eager and only the component is deferred**, which is the whole trick. The
 * ids, names, accents and trails are needed the moment a page draws a scene list or looks up what
 * colour the pad cursor should be — a lazy registry would have made that async for no reason.
 * What is worth deferring is the geometry, and that is all this defers.
 *
 * Eighteen static imports meant every visit downloaded eighteen scenes to look at one. They are
 * not small: a corridor with greebles, five articulated mannequins and a wireframe battle station
 * are each a few tens of kilobytes of geometry and shader, and nobody has ever needed two of them
 * at once. A song names the scene it was written to be seen with, so the one that gets fetched is
 * the one being watched, and switching fetches the next.
 *
 * three itself does not multiply. It is shared by all eighteen, so the bundler keeps it in one
 * chunk that arrives with whichever scene is first — paid once, as before.
 */
function scene(
  load: () => Promise<Record<string, unknown>>,
  name: string,
): LazyExoticComponent<ComponentType> {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }))
}

export interface SceneInfo {
  id: string
  name: string
  Component: LazyExoticComponent<ComponentType>
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
  { id: 'sunset', name: 'Sunset', Component: scene(() => import('./Sunset'), 'Sunset'), accent: '120, 255, 230' },
  { id: 'lifeforms', name: 'Lifeforms', Component: scene(() => import('./Lifeforms'), 'Lifeforms'), accent: '255, 255, 255', trail: { scale: 1.4 } },
  { id: 'wireframe', name: 'Wireframe', Component: scene(() => import('./Wireframe'), 'Wireframe'), accent: '255, 255, 255' },
  // White, because the web is already cycling through every other colour there is.
  { id: 'web', name: 'Web', Component: scene(() => import('./Web'), 'Web'), accent: '255, 255, 255' },
  { id: 'trench', name: 'Trench', Component: scene(() => import('./Trench'), 'Trench'), accent: '120, 255, 210' },
  { id: 'water', name: 'Stillwater', Component: scene(() => import('./Stillwater'), 'Stillwater'), accent: '150, 220, 255', trail: { scale: 1.5 } },
  // Icy blue against a cream planet.
  { id: 'saturn', name: 'Saturn', Component: scene(() => import('./Saturn'), 'Saturn'), accent: '150, 220, 255', trail: { scale: 1.5 } },
  // Small and white: this one is made of fine bright lines and a big soft blob buries them.
  { id: 'cycles', name: 'Light Cycles', Component: scene(() => import('./Cycles'), 'Cycles'), accent: '255, 255, 255', trail: { scale: 0.7 } },
  // Near-white — neither green nor red, so the cursor reads as yours rather than a side's.
  { id: 'defcon', name: 'Defcon', Component: scene(() => import('./Defcon'), 'Defcon'), accent: '255, 250, 200', trail: { scale: 0.8 } },
  // The only dark accent, and the only ring: a dark blob on a bright sky is a smudge on
  // the lens, whereas an outline reads as something drawn on top of it.
  { id: 'clouds', name: 'Clouds', Component: scene(() => import('./Clouds'), 'Clouds'), accent: '40, 70, 130', trail: { scale: 1.8, ring: true } },
  // Magenta, against a stage lit in every other colour, and a small trail: the figures are
  // fine bright lines and a big soft blob buries them.
  { id: 'dancers', name: 'Dancers', Component: scene(() => import('./Dancers'), 'Dancers'), accent: '255, 90, 190', trail: { scale: 0.75 } },
  // Cold white against sodium light. Small enough to stay an inspection point rather than
  // hiding the machinery it is meant to reveal.
  { id: 'machine', name: 'Machine', Component: scene(() => import('./Machine'), 'Machine'), accent: '225, 240, 255', trail: { scale: 0.75 } },
  // Warm white over blue-black glass. The trail is broad enough to read as a wiped patch
  // in condensation rather than another point of light outside the bus.
  { id: 'nightbus', name: 'Night Bus', Component: scene(() => import('./NightBus'), 'NightBus'), accent: '255, 232, 190', trail: { scale: 1.35 } },
  // White, against a scene that is already every arcade colour there is, and a small trail:
  // this one is drawn on a one-cell grid and a big soft blob swallows whole sprites.
  { id: 'jumpman', name: 'Jump Man', Component: scene(() => import('./Jumpman'), 'Jumpman'), accent: '255, 255, 255', trail: { scale: 0.7 } },
  // The scene itself is paper-white, so the gesture is a charcoal ring like a crop mark.
  { id: 'cubik', name: 'Cübik', Component: scene(() => import('./Cubik'), 'Cubik'), accent: '24, 24, 24', trail: { scale: 1.2, ring: true } },
  // Warm white against the cyan machinery and rust-red sun. A small trail keeps the
  // gesture from obscuring the cargo silhouettes that make this scene itself.
  { id: 'convoy', name: 'Endless Convoy', Component: scene(() => import('./Convoy'), 'Convoy'), accent: '255, 250, 220', trail: { scale: 0.75 } },
  // White and ringed because the three editions move between paper, yellow and broadcast
  // blue. It reads as a registration mark in the print systems and a reticle in the ident.
  { id: 'graphic', name: 'Graphic Lab', Component: scene(() => import('./GraphicLab'), 'GraphicLab'), accent: '255, 255, 255', trail: { scale: 0.8, ring: true } },
  // The mark itself persists in the scene, so the pad overlay stays small and quiet.
  { id: 'longhand', name: 'Longhand', Component: scene(() => import('./Longhand'), 'Longhand'), accent: '255, 95, 145', trail: { scale: 0.55 } },
]

export type SceneId = string

export function nextScene(current: SceneId): SceneId {
  const at = SCENES.findIndex((s) => s.id === current)
  return SCENES[(at + 1) % SCENES.length].id
}
