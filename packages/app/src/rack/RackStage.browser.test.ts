import { MODULES, type Patch } from '@driftbox/rack'
import { createElement, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { sizeFor } from './faceplates/index.js'
import { layout } from './layout.js'
import { RackStage } from './RackStage.js'
import './rack.css'
import { useRack } from './store.js'
import { useRackView } from './useRackView.js'
import { nextRackView, type RackView } from './view.js'

// The three arrangements, driven the way the View button drives them.
//
// `view.ts` proves the cycle is a cycle and `rack-motion.test.ts` holds the stylesheet to the code, but
// neither can say what is actually on screen — that the pad bay does not exist in rack view, that the
// stage is `hidden` rather than merely covered in pad view, and that split reopens at the rack rather
// than wherever the pad-side scroll offset was left. All three are things a person sees immediately and
// no Node test can reach.

const PATCH: Patch = {
  modules: [
    { id: 'v', type: 'voice' },
    { id: 'speaker', type: 'out' },
  ],
  cables: [{ from: ['v', 'out'], to: ['speaker', 'in'] }],
}

const GEOMETRY = layout(PATCH.modules, sizeFor(MODULES))

/** The pair as the page uses them: the hook decides, the component lays out. */
function Harness() {
  const [closed, setClosed] = useState(0)
  const view = useRackView(() => setClosed((count) => count + 1))
  return createElement(
    'div',
    null,
    createElement(
      'button',
      { type: 'button', className: 'cycle', onClick: view.cycleRackView },
      `View ${closed}`,
    ),
    createElement(RackStage, {
      rackView: view.rackView,
      viewCycled: view.viewCycled,
      performanceSpace: view.performanceSpace,
      geometry: GEOMETRY,
      flipped: false,
      pad: createElement('div', { className: 'stub-pad' }, 'pad'),
    }),
  )
}

let host: HTMLElement | null = null
let root: ReturnType<typeof createRoot> | null = null

function mount(): { space: () => HTMLElement; cycle: () => HTMLButtonElement } {
  useRack.getState().load(PATCH)
  host = document.createElement('div')
  // Narrower than the two 480px bays, so the split grid is genuinely scrollable and the scroll-offset
  // claim below is about a real offset rather than one that silently stayed at zero.
  host.style.width = '600px'
  document.body.append(host)
  root = createRoot(host)
  flushSync(() => root!.render(createElement(Harness)))
  return {
    space: () => host!.querySelector<HTMLElement>('.rk-performance-space')!,
    cycle: () => host!.querySelector<HTMLButtonElement>('button.cycle')!,
  }
}

afterEach(() => {
  root?.unmount()
  host?.remove()
  root = null
  host = null
})

const viewOf = (space: HTMLElement): RackView =>
  space.classList.contains('rk-performance-space-pad')
    ? 'pad'
    : space.classList.contains('rk-performance-space-split')
      ? 'split'
      : 'rack'

/** A cycle out of rack view runs inside a view transition, so the DOM changes a frame or two later. */
async function settle(done: () => boolean, frames = 90) {
  for (let i = 0; i < frames && !done(); i++) {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
  if (!done()) throw new Error('the view never settled')
}

async function press(cycle: HTMLButtonElement, space: HTMLElement, to: RackView) {
  cycle.click()
  await settle(() => viewOf(space) === to)
}

/** Wherever this window opened, get to a known arrangement first. */
async function driveTo(cycle: HTMLButtonElement, space: HTMLElement, target: RackView) {
  for (let step = 0; step < 3 && viewOf(space) !== target; step++) {
    await press(cycle, space, nextRackView(viewOf(space)))
  }
  expect(viewOf(space)).toBe(target)
}

describe('the stage as each view arranges it', () => {
  it('gives the pad no bay at all until it is asked for', async () => {
    const { space, cycle } = mount()
    await driveTo(cycle(), space(), 'rack')

    expect(space().querySelector('.rk-perform')).toBeNull()
    expect(space().querySelector('.stub-pad')).toBeNull()
    // The rack is the whole view, and it is a live instrument rather than a hidden one.
    expect(space().querySelector<HTMLElement>('.rk-stage')!.hidden).toBe(false)
  })

  it('seats both bays in split, with the rack still on screen', async () => {
    const { space, cycle } = mount()
    await driveTo(cycle(), space(), 'split')

    expect(space().querySelector('.stub-pad')).not.toBeNull()
    expect(space().querySelector<HTMLElement>('.rk-stage')!.hidden).toBe(false)
  })

  it('hides the rack in pad view rather than covering it', async () => {
    const { space, cycle } = mount()
    await driveTo(cycle(), space(), 'pad')

    // `hidden` and not merely off-screen: a rack still in the accessibility tree behind a full-screen pad
    // is a keyboard trap of two hundred knobs.
    expect(space().querySelector<HTMLElement>('.rk-stage')!.hidden).toBe(true)
    expect(space().querySelector('.stub-pad')).not.toBeNull()
  })

  it('keeps one rack with two faces, whichever view it is in', async () => {
    const { space, cycle } = mount()
    await driveTo(cycle(), space(), 'split')

    const snapshot = space().querySelector<HTMLElement>('.rk-rack-snapshot')!
    expect(snapshot.style.width).toBe(`${GEOMETRY.width}px`)
    expect(snapshot.style.height).toBe(`${GEOMETRY.height}px`)
    expect(snapshot.querySelectorAll('.rk-side-front')).toHaveLength(1)
    expect(snapshot.querySelectorAll('.rk-side-back')).toHaveLength(1)
  })
})

describe('arriving at a view versus opening on one', () => {
  it('cancels the entrance until the View button has actually moved something', async () => {
    const { space, cycle } = mount()
    // Nothing has moved yet, so nothing should animate as though it had.
    expect(space().className).toContain('rk-performance-space-seated')

    await press(cycle(), space(), nextRackView(viewOf(space())))
    expect(space().className).not.toContain('rk-performance-space-seated')
  })

  it('closes the panels that make no sense in the next view, in the same update', async () => {
    const { space, cycle } = mount()
    expect(cycle().textContent).toBe('View 0')

    await press(cycle(), space(), nextRackView(viewOf(space())))
    // The counter stands in for the palette and the patch browser: whatever was open closed with the
    // view change rather than a frame after it, so a transition cannot snapshot a panel mid-flight.
    expect(cycle().textContent).toBe('View 1')
  })
})

describe('the scroll offset of the split grid', () => {
  it('reopens at the rack bay after a trip through full-pad mode', async () => {
    const { space, cycle } = mount()
    await driveTo(cycle(), space(), 'split')

    space().scrollLeft = space().scrollWidth
    // Guard the claim itself: if the grid were not scrollable this test would pass without testing.
    expect(space().scrollLeft).toBeGreaterThan(0)

    await press(cycle(), space(), 'pad')
    await press(cycle(), space(), 'rack')
    await press(cycle(), space(), 'split')

    // The node survives all three views, so without the layout effect this reopens with the rack
    // entirely off-screen to the left.
    expect(space().scrollLeft).toBe(0)
  })
})
