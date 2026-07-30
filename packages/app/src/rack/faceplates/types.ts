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
}

export type FaceplateComponent = (props: FaceplateProps) => ReactNode
