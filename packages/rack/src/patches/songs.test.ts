import { SONGS, songPresetById } from '@driftbox/engine'
import { describe, expect, it } from 'vitest'
import { compile } from '../compile.js'
import { grooveboxSong, patchCompatibility } from '../groovebox.js'
import { applyModulation } from '../modulation.js'
import { GROOVEBOX_PORTS } from '../modules/groovebox.js'
import { MODULES } from '../modules/index.js'
import { decodePatch, encodePatch } from '../patch-io.js'
import { SONG_PATCHES, songPatchPresetById } from './songs.js'

// Same standard as `patches.test.ts`, because these are shipped patches and a broken one reads as the whole
// rack being broken. Everything specific to *these* is downstream of one claim: a rack version of a song is
// only a version of it if the song arrives intact and every machine in it reaches the output.

describe.each(SONG_PATCHES.map((preset) => [preset.id, preset] as const))(
  'the %s song patch',
  (_id, preset) => {
    it('is a fresh object every time it is built', () => {
      const a = preset.build()
      const b = preset.build()
      expect(a).not.toBe(b)
      expect(a.modules[0]).not.toBe(b.modules[0])
      expect(a).toEqual(b)
    })

    it('compiles with nothing dropped, nothing missing and nothing left over', () => {
      const plan = compile(preset.build(), MODULES)
      const complain = (kind: string) =>
        plan.notes.filter((note) => note.kind === kind).map((note) => note.detail)

      expect(complain('dropped-cable')).toEqual([])
      expect(complain('placeholder')).toEqual([])
      expect(complain('duplicate-module')).toEqual([])
      expect(complain('replaced-cable')).toEqual([])
    })

    it('reaches the output', () => {
      const plan = compile(preset.build(), MODULES)
      expect(plan.outputs.length).toBeGreaterThan(0)
      expect(plan.nodes.length).toBeGreaterThan(1)
    })

    it('only sets params that exist, within their ranges', () => {
      for (const module of preset.build().modules) {
        const def = MODULES[module.type]
        expect(def, module.type).toBeDefined()
        for (const [id, value] of Object.entries(module.params ?? {})) {
          const param = def.params.find((p) => p.id === id)
          expect(param, `${module.type}.${id}`).toBeDefined()
          expect(value, `${module.type}.${id}`).toBeGreaterThanOrEqual(param!.min)
          expect(value, `${module.type}.${id}`).toBeLessThanOrEqual(param!.max)
        }
      }
    })

    it('round-trips through the patch format unchanged', () => {
      expect(decodePatch(encodePatch(preset.build()))).toEqual(preset.build())
    })

    it('has a name and a blurb worth showing', () => {
      expect(preset.name).not.toBe('')
      expect(preset.blurb.length).toBeGreaterThan(10)
      expect(preset.blurb.length).toBeLessThan(60)
      expect(preset.kicker.length).toBeGreaterThan(8)
      expect(preset.features).toHaveLength(3)
    })

    it('retains the song it says it is a version of, note for note', () => {
      // The point of the whole file. If this decoded to anything other than the shipped song, the patch
      // would be a *cover* of it — and the catalogue would be claiming otherwise.
      const retained = grooveboxSong(preset.build())
      expect(retained, preset.id).not.toBeNull()
      expect(retained).toEqual(songPresetById(preset.song)!.build())
    })

    it('is rack-extended, so nothing offers to flatten it back into a song', () => {
      // A save that wrote only the embedded song would silently throw the desk, the sends and the rack's
      // own instrument away. `patchCompatibility` is what stops that being offered.
      expect(patchCompatibility(preset.build())).toBe('rack-extended')
    })

    it('leaves the tempo to the song rather than overriding it', () => {
      // The host reads `patch.tempo ?? song.bpm`. Writing the same number here would work until somebody
      // changed the song's tempo in the groovebox and the rack's own transport stayed where it was.
      expect(preset.build().tempo).toBeUndefined()
    })

    it('names no break, because the drums are the song’s own', () => {
      // The host renders `patch.break` into a Sampler on the Start gesture, and `loadBreak` adds one if
      // there is nowhere to put the audio. A record that already has an 808 and a 909 in it asking for a
      // chopped amen would arrive with a module nobody patched and at the break's tempo rather than its own.
      const patch = preset.build()
      expect(patch.break, preset.id).toBeUndefined()
      expect(preset.needsBreak, preset.id).toBeUndefined()
      expect(patch.modules.some((module) => module.type === 'sampler'), preset.id).toBe(false)
    })

    it('brings all four machines into the rack, so none of them is heard twice', () => {
      // A stem with no cable stays in the groovebox's own master; a stem with one is pulled out of it and
      // arrives here instead. Half-routing is the failure that sounds like a phasing mix rather than a
      // missing cable — see `routedGrooveboxSections`.
      const patch = preset.build()
      const sources = new Set(
        patch.modules.filter((module) => module.type === 'groovebox').map((module) => module.id),
      )
      for (const section of ['tr808', 'tr909', '303.a', '303.b'] as const) {
        const port = GROOVEBOX_PORTS[section].output
        expect(
          patch.cables.some((cable) => sources.has(cable.from[0]) && cable.from[1] === port),
          `${preset.id}/${section}`,
        ).toBe(true)
      }
    })

    it('adds at least one instrument the groovebox does not have', () => {
      // "Rack++" is the whole promise on the card. A version that only added effects would be a mix.
      const sources = new Set(['vco', 'wavetable', 'noise', 'sampler', 'multisampler', 'voice'])
      expect(
        preset.build().modules.some((module) => sources.has(module.type)),
        preset.id,
      ).toBe(true)
    })

    it('opens with every Combinator target already settled', () => {
      // Loading runs all routes once. A target even a floating-point whisker from its routed value makes
      // the stored copy differ from the catalogue, and the document can no longer recover its title.
      const patch = preset.build()
      expect(applyModulation(patch, MODULES)).toBe(patch)
    })

    it('has the shared macro panel wired, not an ornamental Combinator', () => {
      const routes = preset.build().modulation ?? []
      const controls = new Set(routes.map((route) => route.from.join('.')))
      for (let control = 1; control <= 4; control++) {
        expect(controls, `rotary${control}`).toContain(`combi-1.rotary${control}`)
        expect(controls, `button${control}`).toContain(`combi-1.button${control}`)
      }
      expect(routes.length).toBeGreaterThanOrEqual(13)
    })

    it('monitors both aux sends', () => {
      const patch = preset.build()
      const meters = patch.modules.filter((module) => module.type === 'meter')
      expect(meters.length, preset.id).toBe(2)
      for (const meter of meters) {
        expect(
          patch.cables.some((cable) => cable.to[0] === meter.id && cable.to[1] === 'in'),
          `${preset.id}/${meter.id} input`,
        ).toBe(true)
        expect(
          patch.cables.some((cable) => cable.from[0] === meter.id),
          `${preset.id}/${meter.id} output`,
        ).toBe(true)
      }
    })

    it('sends the room and the echo somewhere real', () => {
      // A send fader up against an effect that reaches nothing is silence you can see moving, which is the
      // most confusing failure a mixer has.
      const patch = preset.build()
      for (const [effect, ret] of [
        ['room-1', 'returnA'],
        ['echo-1', 'returnB'],
      ] as const) {
        expect(
          patch.cables.some((cable) => cable.from[0] === effect && cable.to[1] === ret),
          `${preset.id}/${effect}`,
        ).toBe(true)
      }
    })

    it('runs its room fully wet, because it is on a send', () => {
      const reverb = preset.build().modules.find((module) => module.id === 'room-1')
      expect(reverb?.params?.mix, preset.id).toBe(1)
    })

    it('sets an echo time inside one bar of its own song', () => {
      // The Ping Pong is written as a fraction of a beat. A time longer than a bar is not a delay any
      // more, and one shorter than a thirty-second is a comb filter nobody asked for.
      const patch = preset.build()
      const bpm = grooveboxSong(patch)!.bpm
      const bar = (60 / bpm) * 4
      const time = patch.modules.find((module) => module.id === 'echo-1')?.params?.time
      expect(time, preset.id).toBeGreaterThan(bar / 32)
      expect(time, preset.id).toBeLessThanOrEqual(bar)
    })
  },
)

describe('the rack++ song library', () => {
  it('has unique ids and names, and does not collide with the system patches', () => {
    expect(new Set(SONG_PATCHES.map((p) => p.id)).size).toBe(SONG_PATCHES.length)
    expect(new Set(SONG_PATCHES.map((p) => p.name)).size).toBe(SONG_PATCHES.length)
  })

  it('finds a preset by id, and nothing by a wrong one', () => {
    expect(songPatchPresetById('acieed-plus')?.song).toBe('acid')
    expect(songPatchPresetById('nonesuch')).toBeUndefined()
  })

  it('is built from songs that actually ship', () => {
    // The catalogue names a song by id. Renaming one in the engine has to fail here rather than at load.
    const shipped = new Set(SONGS.map((song) => song.id))
    for (const preset of SONG_PATCHES) expect(shipped, preset.id).toContain(preset.song)
  })

  it('takes each song once, so the shelf is a set rather than variations on one', () => {
    expect(new Set(SONG_PATCHES.map((p) => p.song)).size).toBe(SONG_PATCHES.length)
  })

  it('gives every song a different room and a different rack instrument', () => {
    // The spine is shared deliberately; the character is not allowed to be. Two songs on the same reverb
    // algorithm with the same added voice would be the "bank of settings" `patches.test.ts` guards against.
    const character = SONG_PATCHES.map((preset) => {
      const patch = preset.build()
      const algorithm = patch.modules.find((module) => module.id === 'room-1')?.params?.algorithm ?? 0
      const voices = patch.modules
        .filter((module) => ['vco', 'wavetable', 'noise'].includes(module.type))
        .map((module) => module.type)
        .sort()
        .join('+')
      return `${algorithm}/${voices}`
    })
    expect(new Set(character).size).toBe(SONG_PATCHES.length)
  })

  it('uses the desk, the sends and the width control in every one of them', () => {
    for (const preset of SONG_PATCHES) {
      const types = new Set(preset.build().modules.map((module) => module.type))
      for (const type of ['groovebox', 'line-mixer', 'reverb', 'ping-pong', 'eq', 'imager', 'combi']) {
        expect(types, `${preset.id}/${type}`).toContain(type)
      }
    }
  })

  it('stays the size of a record rather than a capability demo', () => {
    for (const preset of SONG_PATCHES) {
      const patch = preset.build()
      expect(patch.modules.length, preset.id).toBeLessThanOrEqual(22)
      expect(patch.cables.length, preset.id).toBeLessThanOrEqual(30)
    }
  })

  it('writes lane data only into slots a Tracker reads, and never an empty lane', () => {
    for (const preset of SONG_PATCHES) {
      for (const module of preset.build().modules) {
        if (!module.data) continue
        expect(module.type, `${preset.id}/${module.id}`).toBe('tracker')
        const length = module.params?.length ?? 16
        for (const [slot, values] of Object.entries(module.data)) {
          expect(slot, `${preset.id}/${module.id}`).toMatch(/^lane[1-4]$/)
          expect(values.length % length, `${preset.id}/${slot}`).toBe(0)
          expect(values.length, `${preset.id}/${slot}`).toBeGreaterThan(0)
          expect(values.some((value) => value !== 0), `${preset.id}/${slot}`).toBe(true)
        }
      }
    }
  })
})
