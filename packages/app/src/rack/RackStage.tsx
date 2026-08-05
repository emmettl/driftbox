import type { ReactNode, RefObject } from 'react'
import { BackPanel } from './BackPanel.js'
import { Chassis } from './Chassis.js'
import type { Layout } from './layout.js'
import type { RackView } from './view.js'

/**
 * Three views of the same live instrument.
 *
 * In split view the stage and pad share one grid, which moves the rack left into its own bay instead of
 * shrinking it — its design coordinates, knobs and cable hit targets therefore stay exact. On a narrow
 * screen the pair remains horizontally scrollable.
 *
 * The pad arrives as a node rather than as props, because nothing here needs to know what a Kaoss filter
 * is: this file is the geometry of the two bays and the rack's two faces, and that is all.
 */
export function RackStage({
  rackView,
  viewCycled,
  performanceSpace,
  geometry,
  flipped,
  pad,
}: {
  rackView: RackView
  viewCycled: boolean
  performanceSpace: RefObject<HTMLDivElement | null>
  geometry: Layout
  flipped: boolean
  pad: ReactNode
}) {
  return (
    <div
      ref={performanceSpace}
      className={`rk-performance-space rk-performance-space-${rackView}${viewCycled ? '' : ' rk-performance-space-seated'}`}
    >
      {rackView !== 'rack' && <div className="rk-perform">{pad}</div>}

      <div className="rk-stage" hidden={rackView === 'pad'}>
        {/* Keep the view-transition capture outside the element that turns in 3D. Chromium flattens a
            named transition participant; naming rk-rack itself left its rear face unpaintable after a
            Pad → Rack hand-off even though its transform and opacity were correct. */}
        <div
          className="rk-rack-snapshot"
          style={{
            width: geometry.width,
            height: geometry.height,
          }}
        >
          <div className={flipped ? 'rk-rack rk-rack-flipped' : 'rk-rack'}>
            <div className="rk-side rk-side-front">
              <Chassis layout={geometry} />
            </div>
            <div className="rk-side rk-side-back">
              <BackPanel layout={geometry} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
