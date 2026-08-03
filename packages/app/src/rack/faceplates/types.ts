import type { ModuleDef, PatchModule } from '@driftbox/rack'
import type { ReactNode } from 'react'

// What a faceplate is handed.
//
// Deliberately small. A faceplate gets the def, the module's saved state, and a way to read and write
// one param — and nothing else. No store, no audio node, no rack. That is what makes the generic
// fallback possible at all: it can only use what every module has, so a component written against
// this contract works for a module that did not exist when it was written.

export interface FaceplateProps {
  def: ModuleDef
  module: PatchModule
  /** The param's current value, in the param's own units. Falls back to its default. */
  value: (paramId: string) => number
  /** Move a knob. Reaches the audio thread this block; does not rebuild the graph. */
  onChange: (paramId: string, value: number) => void
  /**
   * Whether something other than this knob is driving this param — a Combinator routing, or a recorded
   * lane playing back.
   *
   * The one addition to this contract that is not about the module itself, and it earns its place: a knob
   * that moves on its own and snaps back when you grab it is a bug until you know why. Marking it is the
   * honest fix — the alternative, disabling it, makes a working control dead and hides the reason.
   *
   * Optional, so a faceplate written before routings existed still type-checks and still works; it simply
   * does not mark anything. Same shape of promise the registry itself makes.
   */
  routed?: (paramId: string) => boolean
}

export type FaceplateComponent = (props: FaceplateProps) => ReactNode
