import type { ModuleDef, Processor } from '../types.js'

// Four rotaries and four buttons that move other modules' knobs. Reason's Combinator, as a module.
//
// **This is a panel of macro controls, not a container.** Reason's Combinator holds devices; the thing that
// makes it a Combinator is the row of four rotaries and four buttons on the front, each wired on the back to
// parameters of whatever is inside — one gesture opening a filter, shortening a decay and pushing a send at
// once. Holding the devices is how Reason scoped *which* parameters a rotary could reach, and it cost it a
// tree in the document, a tree in the rack and a rule for what a cable leaving a container means.
//
// A route here names its target by module id, which the patch format already had, so nothing needs
// containing: `Patch.modulation` is a flat list and a rotary can reach anything in the rack. That is a
// larger reach than Reason's, and the honest cost is that a Combinator and the modules it drives are only
// grouped by intent — move one away and the routing still works. Worth it; a rack of chunks is already
// arranged by intent rather than by containment, and `chunks/index.ts` argues that case at length.
//
// **The controls are also CV outlets, which Reason's were not.** A rotary's position leaves here as 0..1 and
// a button's as a gate, so the same knob can sweep a filter's *parameter* through a routing and open a VCA
// through a *cable* at the same time. It costs one line, because a graph where audio and CV are the same
// Float32Array has nothing to convert — and it means a Combinator is useful the moment it is dropped in,
// before anybody has opened the routing panel.
//
// **No inlets.** A CV inlet that moved a rotary would be a second writer on a param the host owns, which is
// the exact fight `ParamDef.hidden` documents for the MIDI module — the knob would read one value while the
// audio thread held another, and nudging it would snap the CV's work away. A rotary is something a person
// turns; anything a cable should drive is an inlet on the module that cares.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

/** Rotaries and buttons, four each. Reason's number, and it is a good one: four is as many macro controls
 *  as anybody can hold in their head, and the fifth is where a Combi patch stops being playable. */
const CONTROLS = 4

/**
 * Rotaries run 0..127 rather than 0..1.
 *
 * Reason's range, kept because a routing is written in the *target's* units and the source's units then only
 * ever show up on the Combinator's own faceplate — where a whole number a MIDI controller could have sent is
 * more use than a decimal. It also means `applyModulation` normalises rather than assuming, which is what
 * lets a route be driven by a button, a rotary, or any other param a later module invents.
 */
const ROTARY_MAX = 127

export class CombiProcessor implements Processor {
  process(
    _inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    // Derived rather than a constant: this class is serialised into a scope that shares nothing with this
    // module, so it cannot read one. Half the outlets are rotaries and half are buttons, in that order.
    const rotaries = outlets.length / 2

    for (let control = 0; control < rotaries; control++) {
      const rotary = outlets[control]
      const knob = params[control]
      for (let i = 0; i < frames; i++) {
        // 127 inlined for the same reason the lane count is in `tracker.ts`: a constant at module scope
        // would not survive being stringified into the worklet.
        let value = knob[i] / 127
        if (value < 0) value = 0
        else if (value > 1) value = 1
        rotary[i] = value
      }

      const gate = outlets[rotaries + control]
      const button = params[rotaries + control]
      for (let i = 0; i < frames; i++) gate[i] = button[i] >= 0.5 ? 1 : 0
    }
  }
}

const rotary = (index: number) => ({
  id: `rotary${index + 1}`,
  name: `Rotary ${index + 1}`,
  min: 0,
  max: ROTARY_MAX,
  // Centred, so a fresh route written across a target's full range starts halfway rather than slammed
  // against one end of it. Reason's rotaries rest at 64 for the same reason.
  default: Math.round(ROTARY_MAX / 2),
})

const button = (index: number) => ({
  id: `button${index + 1}`,
  name: `Button ${index + 1}`,
  min: 0,
  max: 1,
  default: 0,
  stepped: true,
  labels: ['Off', 'On'] as const,
})

export const COMBI_MODULE: ModuleDef = {
  type: 'combi',
  version: 1,
  name: 'Combinator',
  // See the note above: nothing patches *into* a macro control.
  inlets: [],
  // Rotaries then buttons, matching the param order, because the processor derives which is which from
  // `outlets.length / 2` and the two lists have to agree. `combi.test.ts` asserts the layout, so inserting
  // a control at the front fails a test rather than quietly turning a rotary into a gate.
  outlets: [
    ...Array.from({ length: CONTROLS }, (_, i) => ({
      id: `rotary${i + 1}`,
      name: `Rotary ${i + 1}`,
    })),
    ...Array.from({ length: CONTROLS }, (_, i) => ({
      id: `button${i + 1}`,
      name: `Button ${i + 1}`,
    })),
  ],
  params: [
    ...Array.from({ length: CONTROLS }, (_, i) => rotary(i)),
    ...Array.from({ length: CONTROLS }, (_, i) => button(i)),
  ],
  processor: CombiProcessor,
  // One panel of macro controls, however many voices the patch has. Eight copies would be eight identical
  // ones — and more to the point a routing writes a *param*, which `Rack.setParam` already spreads across
  // every voice, so a per-voice Combinator would have nothing different to say.
  poly: false,
}

/** So a host does not have to hardcode how many of each there are. */
export const COMBI_CONTROLS = CONTROLS
export const COMBI_ROTARY_MAX = ROTARY_MAX
