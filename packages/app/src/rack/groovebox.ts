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
 * The current stereo outlet and both historical mono aliases select the same section. Routing one old
 * channel still has to remove the complete machine from the original master or the other side would bypass
 * the rack and the patched side would be heard twice.
 */
export function routedGrooveboxSections(patch: Patch): GrooveboxSection[] {
  const sourceIds = new Set(
    patch.modules.filter((module) => module.type === 'groovebox').map((module) => module.id),
  )
  return GROOVEBOX_SECTIONS.filter((section) => {
    const ports = GROOVEBOX_PORTS[section]
    const ids = new Set([ports.output, ports.left, ports.right])
    return patch.cables.some(
      (cable) =>
        sourceIds.has(cable.from[0]) &&
        ids.has(cable.from[1]),
    )
  })
}
