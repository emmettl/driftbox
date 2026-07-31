import { MODULE_LIST, MODULES, PATCHES, type ModuleDef, type Patch, type PatchCable } from '@driftbox/rack'
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
function edgeTime(
  turn: Animation,
  rack: HTMLElement,
  duration: number,
  startsFacingFront: boolean,
): number {
  let before = 0
  let after = duration
  for (let step = 0; step < 18; step++) {
    const middle = (before + after) / 2
    turn.currentTime = middle
    const facingFront = new DOMMatrixReadOnly(getComputedStyle(rack).transform).m11 > 0
    if (facingFront === startsFacingFront) before = middle
    else after = middle
  }
  return after
}

async function expectFaceHandoff(patch: Patch, subjectId: string, subjectType: string) {
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
      `.rk-module[data-module-id='${subjectId}'][data-module-type='${subjectType}']`,
    )
    const front = rack.querySelector<HTMLElement>('.rk-side-front')!
    const rear = rack.querySelector<HTMLElement>('.rk-side-back')!
    const cable = rack.querySelector<SVGGElement>('.rk-cable')!

    expect(subject).toBeTruthy()
    expect(front).toBeTruthy()
    expect(rear).toBeTruthy()
    expect(cable).toBeTruthy()

    // Commit the unflipped style before changing state so the browser creates a real transition.
    expect(getComputedStyle(rack).transform).toBe('none')
    flushSync(() => useRack.getState().flip(true))
    await frame()

    const animations = rack.getAnimations()
    expect(animations.some((animation) => animation instanceof CSSAnimation)).toBe(false)
    const turn = animations.find(
      (animation): animation is CSSTransition =>
        animation instanceof CSSTransition && animation.transitionProperty === 'transform',
    )
    const frontSwitch = front.getAnimations().find(
      (animation): animation is CSSTransition =>
        animation instanceof CSSTransition && animation.transitionProperty === 'opacity',
    )
    const rearSwitch = rear.getAnimations().find(
      (animation): animation is CSSTransition =>
        animation instanceof CSSTransition && animation.transitionProperty === 'opacity',
    )
    expect(turn).toBeTruthy()
    expect(frontSwitch).toBeTruthy()
    expect(rearSwitch).toBeTruthy()
    expect(Math.abs(Number(turn!.startTime) - Number(frontSwitch!.startTime))).toBeLessThan(2)
    expect(Math.abs(Number(turn!.startTime) - Number(rearSwitch!.startTime))).toBeLessThan(2)
    turn!.pause()
    frontSwitch!.pause()
    rearSwitch!.pause()
    await Promise.all([turn!.ready, frontSwitch!.ready, rearSwitch!.ready])

    const duration = Number(turn!.effect!.getTiming().duration)
    const edge = edgeTime(turn!, rack, duration, true)
    const margin = duration * 0.005
    const switchTime = Number(frontSwitch!.effect!.getTiming().delay)
    expect(Number(rearSwitch!.effect!.getTiming().delay)).toBe(switchTime)
    expect(switchTime).toBeGreaterThan(edge)
    expect(switchTime - edge).toBeLessThan(margin)

    turn!.currentTime = edge - margin
    frontSwitch!.currentTime = edge - margin
    rearSwitch!.currentTime = edge - margin
    expect(getComputedStyle(front).opacity).toBe('1')
    expect(getComputedStyle(rear).opacity).toBe('0')

    turn!.currentTime = edge + margin
    frontSwitch!.currentTime = edge + margin
    rearSwitch!.currentTime = edge + margin
    expect(new DOMMatrixReadOnly(getComputedStyle(rack).transform).m11).toBeLessThan(0)
    expect(Number(turn!.currentTime)).toBeLessThan(duration)
    expect(getComputedStyle(front).opacity).toBe('0')
    expect(getComputedStyle(rear).opacity).toBe('1')

    // Finish at the back, then exercise a genuinely new reverse transition. The front must stay hidden
    // through the first half rather than appearing as soon as the flipped class is removed.
    turn!.finish()
    frontSwitch!.finish()
    rearSwitch!.finish()
    flushSync(() => useRack.getState().flip(false))
    await frame()

    const reverseTurn = rack.getAnimations().find(
      (animation): animation is CSSTransition =>
        animation instanceof CSSTransition && animation.transitionProperty === 'transform',
    )
    const reverseFrontSwitch = front.getAnimations().find(
      (animation): animation is CSSTransition =>
        animation instanceof CSSTransition && animation.transitionProperty === 'opacity',
    )
    const reverseRearSwitch = rear.getAnimations().find(
      (animation): animation is CSSTransition =>
        animation instanceof CSSTransition && animation.transitionProperty === 'opacity',
    )
    expect(reverseTurn).toBeTruthy()
    expect(reverseFrontSwitch).toBeTruthy()
    expect(reverseRearSwitch).toBeTruthy()
    reverseTurn!.pause()
    reverseFrontSwitch!.pause()
    reverseRearSwitch!.pause()
    await Promise.all([
      reverseTurn!.ready,
      reverseFrontSwitch!.ready,
      reverseRearSwitch!.ready,
    ])

    const reverseDuration = Number(reverseTurn!.effect!.getTiming().duration)
    const reverseEdge = edgeTime(reverseTurn!, rack, reverseDuration, false)
    const reverseMargin = reverseDuration * 0.005
    const reverseSwitchTime = Number(reverseFrontSwitch!.effect!.getTiming().delay)
    expect(Number(reverseRearSwitch!.effect!.getTiming().delay)).toBe(reverseSwitchTime)
    expect(reverseSwitchTime).toBeGreaterThan(reverseEdge)
    expect(reverseSwitchTime - reverseEdge).toBeLessThan(reverseMargin)

    reverseTurn!.currentTime = reverseEdge - reverseMargin
    reverseFrontSwitch!.currentTime = reverseEdge - reverseMargin
    reverseRearSwitch!.currentTime = reverseEdge - reverseMargin
    expect(new DOMMatrixReadOnly(getComputedStyle(rack).transform).m11).toBeLessThan(0)
    expect(getComputedStyle(front).opacity).toBe('0')
    expect(getComputedStyle(rear).opacity).toBe('1')

    reverseTurn!.currentTime = reverseEdge + reverseMargin
    reverseFrontSwitch!.currentTime = reverseEdge + reverseMargin
    reverseRearSwitch!.currentTime = reverseEdge + reverseMargin
    expect(new DOMMatrixReadOnly(getComputedStyle(rack).transform).m11).toBeGreaterThan(0)
    expect(Number(reverseTurn!.currentTime)).toBeLessThan(reverseDuration)
    expect(getComputedStyle(front).opacity).toBe('1')
    expect(getComputedStyle(rear).opacity).toBe('0')
  } finally {
    flushSync(() => root.unmount())
    host.remove()
    useRack.getState().flip(false)
  }
}

describe('every module through a rack turn', () => {
  it.each(MODULE_LIST.map((def) => [def.type, def] as const))(
    '%s switches to the rear face at the edge',
    async (_type, def) => {
      await expectFaceHandoff(patchFor(def), 'subject', def.type)
    },
  )

  it('switches the fully routed Pressure System Combinator at the edge in both directions', async () => {
    const patch = PATCHES.find((preset) => preset.id === 'pressure-system')!.build()
    const combinator = patch.modules.find((module) => module.type === 'combi')!

    expect(patch.modulation?.filter((route) => route.from[0] === combinator.id)).toHaveLength(16)
    await expectFaceHandoff(patch, combinator.id, combinator.type)
  })
})

describe('the rack after a performance view cycle', () => {
  it('still paints the rear face after the stationary shell participates in view transitions', async () => {
    const host = document.createElement('div')
    host.innerHTML = `
      <div class="rk-stage" style="padding: 0">
        <div class="rk-rack-snapshot" style="width: 240px; height: 240px">
          <div class="rk-rack">
            <div class="rk-side rk-side-front">front</div>
            <div class="rk-side rk-side-back">rear</div>
          </div>
        </div>
        <div class="rk-perform" hidden>
          <div class="rk-pad" style="width: 240px; height: 240px"></div>
        </div>
      </div>
    `
    document.body.append(host)

    const root = document.documentElement
    const snapshot = host.querySelector<HTMLElement>('.rk-rack-snapshot')!
    const perform = host.querySelector<HTMLElement>('.rk-perform')!
    const rack = host.querySelector<HTMLElement>('.rk-rack')!
    const front = host.querySelector<HTMLElement>('.rk-side-front')!
    const rear = host.querySelector<HTMLElement>('.rk-side-back')!

    try {
      root.dataset.rackViewTransition = 'split-pad'
      const toPad = document.startViewTransition(() => {
        snapshot.hidden = true
        perform.hidden = false
      })
      await toPad.finished

      root.dataset.rackViewTransition = 'pad-rack'
      const toRack = document.startViewTransition(() => {
        perform.hidden = true
        snapshot.hidden = false
      })
      await toRack.finished
      delete root.dataset.rackViewTransition

      rack.classList.add('rk-rack-flipped')
      await frame()
      const faceAnimations = [
        ...rack.getAnimations(),
        ...front.getAnimations(),
        ...rear.getAnimations(),
      ]
      for (const animation of faceAnimations) {
        animation.finish()
      }
      await frame()

      expect(getComputedStyle(front).opacity).toBe('0')
      expect(getComputedStyle(rear).opacity).toBe('1')
      const bounds = rear.getBoundingClientRect()
      const painted = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + 20)
      expect(painted === rear || rear.contains(painted)).toBe(true)
    } finally {
      delete root.dataset.rackViewTransition
      host.remove()
    }
  })
})
