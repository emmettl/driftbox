import {
  GROOVEBOX_PORTS,
  type Patch,
} from '@driftbox/rack'
import {
  GROOVEBOX_SECTIONS,
  type GrooveboxSection,
} from '@driftbox/engine'

/**
 * Authored machines whose dry signal has at least one rack cable.
 *
 * Both stereo outlets select the same section: routing only the left jack still has to
 * remove the complete machine from the original master or its right side would bypass
 * the rack and the left would be heard twice.
 */
export function routedGrooveboxSections(patch: Patch): GrooveboxSection[] {
  const sourceIds = new Set(
    patch.modules.filter((module) => module.type === 'groovebox').map((module) => module.id),
  )
  return GROOVEBOX_SECTIONS.filter((section) => {
    const ports = GROOVEBOX_PORTS[section]
    return patch.cables.some(
      (cable) =>
        sourceIds.has(cable.from[0]) &&
        (cable.from[1] === ports.left || cable.from[1] === ports.right),
    )
  })
}
