import type { Registry } from '../types.js'
import { LADDER_MODULE } from './ladder.js'
import { OUT_MODULE } from './out.js'
import { VCO_MODULE } from './vco.js'

// Three modules: an oscillator, a filter, an output.
//
// That is the spine and no more. `docs/RACK.md` lists the twelve that follow, and each of
// them is a self-contained class, a def, and a test — cheap and independent, and none of
// them can break another. This first three had to prove the compiler, the plan, the
// parameter path and the serialisation into the worklet, which is where all the risk was.

export const MODULES: Registry = {
  [VCO_MODULE.type]: VCO_MODULE,
  [LADDER_MODULE.type]: LADDER_MODULE,
  [OUT_MODULE.type]: OUT_MODULE,
}

export { LADDER_MODULE, LadderProcessor } from './ladder.js'
export { OUT_MODULE, OutProcessor } from './out.js'
export { VCO_MODULE, VcoProcessor } from './vco.js'
