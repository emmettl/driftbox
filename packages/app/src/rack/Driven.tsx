import type { ModuleDef, PatchModule } from '@driftbox/rack'
import { faceplateFor } from './faceplates/index.js'
import { useLive } from './live.js'

// A faceplate, showing what its parameters are actually doing.
//
// **Every faceplate gets this and none of them changed**, which is the point of it being here rather than
// in each of them. The Chassis is the single place that decides what `value` and `routed` mean, so a knob
// that follows its automation lane costs the generic fallback nothing and costs a hand-built panel nothing
// — the same property that lets a module be added without any UI work at all.
//
// Its own component rather than inline in the Chassis so the subscription is **per module**. Subscribing at
// the Chassis would re-render every module in the rack whenever any one of them was driven, which for an
// animation-rate feed is the difference between a rack that idles and one that does not.
//
// `routed` widens here from "a Combinator is driving this" to "something other than you is driving this".
// That is the honest reading of what the mark is for — its own comment says a knob that moves on its own
// and snaps back when you grab it is a bug until you know why — and a lane is exactly that.

interface Props {
  def: ModuleDef
  module: PatchModule
  value: (paramId: string) => number
  onChange: (paramId: string, value: number) => void
  routed: (paramId: string) => boolean
}

export function Driven({ def, module, value, onChange, routed }: Props) {
  const live = useLive(module.id)
  const Faceplate = faceplateFor(def.type)

  return (
    <Faceplate
      def={def}
      module={module}
      // The lane wins while it is playing. Not a merge and not a preference the user sets: if something is
      // driving a parameter then that is its value, and showing the stored one instead would be a panel
      // that disagrees with the sound coming out of it.
      value={(paramId) => live?.[paramId] ?? value(paramId)}
      onChange={onChange}
      routed={(paramId) => live?.[paramId] !== undefined || routed(paramId)}
    />
  )
}
