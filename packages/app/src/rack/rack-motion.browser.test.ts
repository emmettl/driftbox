import { MODULE_LIST, MODULES, type ModuleDef, type Patch, type PatchCable } from '@driftbox/rack'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { BackPanel } from './BackPanel.js'
import { Chassis } from './Chassis.js'
import { sizeFor } from './faceplates/index.js'
import { layout, type Layout } from './layout.js'
import './rack.css'
import { useRack } from './store.js'

const SOURCE = MODULES.vco.outlets[0]
const SINK = MODULES.out.inlets[0]

function patchFor(def: ModuleDef): Patch {
  const modules = [
    { id: 'subject', type: def.type },
    { id: 'source', type: 'vco' },
    { id: 'sink', type: 'out' },
  ]
  const cable: PatchCable | undefined = def.outlets[0]
    ? { from: ['subject', def.outlets[0].id], to: ['sink', SINK.id] }
    : def.inlets[0]
      ? { from: ['source', SOURCE.id], to: ['subject', def.inlets[0].id] }
      : undefined

  if (!cable) throw new Error(`${def.type} has no port with which to exercise the rear cable layer`)
  return { modules, cables: [cable] }
}

function TurnHarness({ geometry }: { geometry: Layout }) {
  const flipped = useRack((state) => state.flipped)
  return createElement(
    'div',
    { className: 'rk-stage' },
    createElement(
      'div',
      {
        className: flipped ? 'rk-rack rk-rack-flipped' : 'rk-rack',
        style: { width: geometry.width, height: geometry.height },
      },
      createElement('div', { className: 'rk-side rk-side-front' }, createElement(Chassis, { layout: geometry })),
      createElement('div', { className: 'rk-side rk-side-back' }, createElement(BackPanel, { layout: geometry })),
    ),
  )
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/** Find when the real CSS transition reaches edge-on instead of duplicating its easing arithmetic here. */
function edgeTime(turn: Animation, rack: HTMLElement, duration: number): number {
  let before = 0
  let after = duration
  for (let step = 0; step < 18; step++) {
    const middle = (before + after) / 2
    turn.currentTime = middle
    const facingFront = new DOMMatrixReadOnly(getComputedStyle(rack).transform).m11 > 0
    if (facingFront) before = middle
    else after = middle
  }
  return after
}

describe('every module through a rack turn', () => {
  it.each(MODULE_LIST.map((def) => [def.type, def] as const))(
    '%s keeps the rear cable hand-off at the edge',
    async (_type, def) => {
      const patch = patchFor(def)
      const geometry = layout(patch.modules, sizeFor(MODULES))
      useRack.getState().flip(false)
      useRack.getState().load(patch)

      const host = document.createElement('div')
      document.body.append(host)
      const root = createRoot(host)

      try {
        flushSync(() => root.render(createElement(TurnHarness, { geometry })))
        const rack = host.querySelector<HTMLElement>('.rk-rack')!
        const subject = rack.querySelector<HTMLElement>(
          `.rk-module[data-module-id='subject'][data-module-type='${def.type}']`,
        )
        const cable = rack.querySelector<SVGGElement>('.rk-cable')!

        expect(subject).toBeTruthy()
        expect(cable).toBeTruthy()

        // Commit the unflipped style before changing state so the browser creates a real transition.
        expect(getComputedStyle(rack).transform).toBe('none')
        flushSync(() => useRack.getState().flip(true))
        await frame()

        const animations = rack.getAnimations()
        const turn = animations.find(
          (animation): animation is CSSTransition =>
            animation instanceof CSSTransition && animation.transitionProperty === 'transform',
        )
        const reveal = animations.find(
          (animation): animation is CSSAnimation =>
            animation instanceof CSSAnimation && animation.animationName === 'rk-reveal-rear-cables',
        )
        expect(turn).toBeTruthy()
        expect(reveal).toBeTruthy()
        expect(Math.abs(Number(turn!.startTime) - Number(reveal!.startTime))).toBeLessThan(2)
        turn!.pause()
        reveal!.pause()
        await Promise.all([turn!.ready, reveal!.ready])

        const duration = Number(turn!.effect!.getTiming().duration)
        const edge = edgeTime(turn!, rack, duration)
        const margin = duration * 0.005

        reveal!.currentTime = edge - margin
        expect(getComputedStyle(cable).opacity).toBe('0')

        turn!.currentTime = edge + margin
        reveal!.currentTime = edge + margin
        expect(new DOMMatrixReadOnly(getComputedStyle(rack).transform).m11).toBeLessThan(0)
        expect(getComputedStyle(cable).opacity).toBe('1')

        // Removing the flipped class is the reverse direction. It must not carry the front-to-back delay
        // back with it: the cables remain visible through the first half while the rear face still faces us.
        turn!.currentTime = duration
        reveal!.currentTime = duration
        flushSync(() => useRack.getState().flip(false))
        await frame()
        expect(
          rack
            .getAnimations()
            .some(
              (animation) =>
                animation instanceof CSSAnimation &&
                animation.animationName === 'rk-reveal-rear-cables',
            ),
        ).toBe(false)
        expect(getComputedStyle(cable).opacity).toBe('1')
      } finally {
        flushSync(() => root.unmount())
        host.remove()
        useRack.getState().flip(false)
      }
    },
  )
})
