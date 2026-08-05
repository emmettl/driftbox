import { buildLabel, buildTitle } from '../version.js'
import { rackHint } from './hints.js'
import type { RackView } from './view.js'

/**
 * The quiet line at the bottom: how big the patch is, what your hands can do here, and which build this is.
 *
 * The build label is last and unemphasised on purpose. It is the answer to "which build is this?" — asked
 * once, when something is wrong — so it should be findable rather than prominent.
 */
export function RackFooter({
  modules,
  cables,
  rackView,
  flipped,
}: {
  modules: number
  cables: number
  rackView: RackView
  flipped: boolean
}) {
  return (
    <footer className="rk-footer">
      <span>
        {modules} modules · {cables} cables
      </span>
      <span className="rk-hint">{rackHint(rackView, flipped)}</span>
      <span className="rk-build" title={buildTitle()}>
        {buildLabel()}
      </span>
    </footer>
  )
}
