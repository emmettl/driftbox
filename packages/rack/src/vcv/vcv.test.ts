import { describe, expect, it } from 'vitest'
import { compile } from '../compile.js'
import { MODULES } from '../modules/index.js'
import { decodePatch, encodePatch } from '../patch-io.js'
import { VCV_MODELS, importVcv, importVcvPatch } from './index.js'
import { listZip, readZipText } from './zip.js'

// The zip is built here rather than committed as a fixture. A real `.vcv` from Rack would be the better
// fixture and there is not one to hand — and building it means the awkward cases are reachable: stored as well
// as deflated, extra fields present, several entries, a truncated file, an archive with no patch.json in it.

const LOCAL = 0x04034b50
const CENTRAL = 0x02014b50
const EOCD = 0x06054b50

interface Member {
  name: string
  body: string
  /** Store it rather than deflate it. Both are legal and a real zip mixes them. */
  stored?: boolean
  /** Extra bytes in the local header only, which is legal and is why its length must be read there. */
  extra?: number
}

async function zip(members: Member[]): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const member of members) {
    const name = encoder.encode(member.name)
    const plain = encoder.encode(member.body)
    let data = plain
    if (!member.stored) {
      const stream = new Blob([plain as BufferSource])
        .stream()
        .pipeThrough(new CompressionStream('deflate-raw'))
      data = new Uint8Array(await new Response(stream).arrayBuffer())
    }
    const method = member.stored ? 0 : 8
    const extra = new Uint8Array(member.extra ?? 0)

    const local = new Uint8Array(30 + name.length + extra.length + data.length)
    const view = new DataView(local.buffer)
    view.setUint32(0, LOCAL, true)
    view.setUint16(8, method, true)
    // CRC left at zero: this reader does not check it, which is written down in zip.ts.
    view.setUint32(18, data.length, true)
    view.setUint32(22, plain.length, true)
    view.setUint16(26, name.length, true)
    view.setUint16(28, extra.length, true)
    local.set(name, 30)
    local.set(extra, 30 + name.length)
    local.set(data, 30 + name.length + extra.length)
    parts.push(local)

    const entry = new Uint8Array(46 + name.length)
    const cView = new DataView(entry.buffer)
    cView.setUint32(0, CENTRAL, true)
    cView.setUint16(10, method, true)
    cView.setUint32(20, data.length, true)
    cView.setUint32(24, plain.length, true)
    cView.setUint16(28, name.length, true)
    cView.setUint32(42, offset, true)
    entry.set(name, 46)
    central.push(entry)

    offset += local.length
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const eView = new DataView(end.buffer)
  eView.setUint32(0, EOCD, true)
  eView.setUint16(8, members.length, true)
  eView.setUint16(10, members.length, true)
  eView.setUint32(12, centralSize, true)
  eView.setUint32(16, offset, true)

  const all = [...parts, ...central, end]
  const total = all.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of all) {
    out.set(part, at)
    at += part.length
  }
  return out.buffer
}

const PATCH_JSON = JSON.stringify({
  version: '2.5.2',
  modules: [
    { id: 7, plugin: 'Fundamental', model: 'VCO', pos: [0, 0] },
    { id: 8, plugin: 'Fundamental', model: 'VCF', pos: [10, 0] },
    { id: 9, plugin: 'Core', model: 'AudioInterface', pos: [20, 0] },
  ],
  cables: [
    { id: 1, outputModuleId: 7, outputId: 2, inputModuleId: 8, inputId: 4 },
    { id: 2, outputModuleId: 8, outputId: 0, inputModuleId: 9, inputId: 0 },
  ],
})

describe('getting a file out of a zip', () => {
  it('reads a deflated entry', async () => {
    const buffer = await zip([{ name: 'patch.json', body: PATCH_JSON }])
    expect(await readZipText(buffer, 'patch.json')).toBe(PATCH_JSON)
  })

  it('reads a stored entry', async () => {
    // Both are legal and a real zip mixes them — a small file often ends up stored because deflating it makes
    // it bigger.
    const buffer = await zip([{ name: 'patch.json', body: '{"modules":[]}', stored: true }])
    expect(await readZipText(buffer, 'patch.json')).toBe('{"modules":[]}')
  })

  it('finds the right entry among several', async () => {
    const buffer = await zip([
      { name: 'meta.json', body: '{"a":1}' },
      { name: 'patch.json', body: PATCH_JSON },
      { name: 'modules/thing.bin', body: 'xxxx', stored: true },
    ])
    expect(await readZipText(buffer, 'patch.json')).toBe(PATCH_JSON)
    expect(listZip(buffer)).toEqual(['meta.json', 'patch.json', 'modules/thing.bin'])
  })

  it('reads the extra-field length from the local header, not the central directory', async () => {
    // They are allowed to differ, and reusing the central one lands the read a few bytes into the data.
    const buffer = await zip([{ name: 'patch.json', body: PATCH_JSON, extra: 11 }])
    expect(await readZipText(buffer, 'patch.json')).toBe(PATCH_JSON)
  })

  it('is null for a name that is not in there', async () => {
    const buffer = await zip([{ name: 'other.json', body: '{}' }])
    expect(await readZipText(buffer, 'patch.json')).toBeNull()
  })

  it('is null rather than a throw for something that is not a zip', async () => {
    for (const junk of [new ArrayBuffer(0), new ArrayBuffer(64), new TextEncoder().encode('not a zip at all').buffer]) {
      expect(await readZipText(junk as ArrayBuffer, 'patch.json')).toBeNull()
      expect(listZip(junk as ArrayBuffer)).toEqual([])
    }
  })

  it('is null for a truncated archive', async () => {
    // Half a download. The caller is reading a file somebody fetched, so this happens.
    const buffer = await zip([{ name: 'patch.json', body: PATCH_JSON }])
    expect(await readZipText(buffer.slice(0, buffer.byteLength - 8), 'patch.json')).toBeNull()
    expect(await readZipText(buffer.slice(0, 40), 'patch.json')).toBeNull()
  })
})

describe('importing a VCV patch', () => {
  it('maps the models it knows and wires them together', async () => {
    const result = await importVcv(await zip([{ name: 'patch.json', body: PATCH_JSON }]))
    expect(result).not.toBeNull()
    const { patch, notes } = result!

    expect(patch.modules.map((m) => m.type)).toEqual(['vco', 'svf', 'out'])
    expect(patch.cables).toHaveLength(2)
    // Every mapping is reported, both endpoints named — which is the whole safety net for a port index table
    // that has not been checked against a file Rack actually wrote.
    expect(notes.filter((n) => n.kind === 'mapped').length).toBeGreaterThanOrEqual(5)
  })

  it('produces a patch this build can actually compile and play', async () => {
    const { patch } = (await importVcv(await zip([{ name: 'patch.json', body: PATCH_JSON }])))!
    const plan = compile(patch, MODULES)
    expect(plan.notes.filter((n) => n.kind === 'dropped-cable')).toEqual([])
    expect(plan.outputs.length).toBeGreaterThan(0)
    expect(plan.nodes.map((n) => n.type)).toEqual(['vco', 'svf', 'out'])
  })

  it('keeps a highpass a highpass', () => {
    // The table used to send VCF's LPF and HPF jacks to the Ladder's one lowpass outlet, so a highpass branch
    // silently became a second lowpass — a patch that sounds subtly wrong for reasons nobody can find, which
    // is the exact failure the report exists to prevent.
    const { patch, notes } = importVcvPatch(
      JSON.stringify({
        modules: [
          { id: 1, plugin: 'Fundamental', model: 'VCF' },
          { id: 2, plugin: 'Core', model: 'AudioInterface' },
        ],
        cables: [
          { outputModuleId: 1, outputId: 0, inputModuleId: 2, inputId: 0 },
          { outputModuleId: 1, outputId: 1, inputModuleId: 2, inputId: 1 },
        ],
      }),
    )!
    expect(patch.cables.map((c) => c.from[1])).toEqual(['lp', 'hp'])
    // And the swap it cost is said out loud rather than left for somebody to notice by ear.
    expect(notes.some((n) => n.kind === 'approximate' && n.detail.includes('ladder-derived'))).toBe(true)
  })

  it('says when several jacks arrive at one, once per jack', () => {
    // Four waveform outputs land on the VCO's single Out, and fanning that out three ways is still one fact
    // about one jack. Before this it was reported as `mapped` — indistinguishable from an exact match.
    const { notes } = importVcvPatch(
      JSON.stringify({
        modules: [
          { id: 1, plugin: 'Fundamental', model: 'VCO' },
          { id: 2, plugin: 'Fundamental', model: 'VCA' },
          { id: 3, plugin: 'Fundamental', model: 'VCA' },
        ],
        cables: [
          { outputModuleId: 1, outputId: 0, inputModuleId: 2, inputId: 1 },
          { outputModuleId: 1, outputId: 2, inputModuleId: 3, inputId: 1 },
        ],
      }),
    )!
    const folds = notes.filter((n) => n.kind === 'approximate')
    expect(folds).toHaveLength(1)
    expect(folds[0].detail).toContain('vco-1.out')
  })

  it('says that an audio interface arrives summed and centred', () => {
    // The Out's In became stereo after this importer was written, so VCV's two mono inputs both feed both
    // channels. One module stays one module — the alternative was inventing a second Out with a pan knob we
    // wrote ourselves — so what is owed is the sentence.
    const { patch, notes } = importVcvPatch(
      JSON.stringify({
        modules: [
          { id: 1, plugin: 'Fundamental', model: 'VCO' },
          { id: 2, plugin: 'Core', model: 'Audio8' },
        ],
        cables: [
          { outputModuleId: 1, outputId: 0, inputModuleId: 2, inputId: 0 },
          { outputModuleId: 1, outputId: 0, inputModuleId: 2, inputId: 1 },
          // Past the pair there is nothing to map to, and that is a dropped cable rather than a guess.
          { outputModuleId: 1, outputId: 0, inputModuleId: 2, inputId: 4 },
        ],
      }),
    )!
    expect(patch.modules.map((m) => m.type)).toEqual(['vco', 'out'])
    expect(patch.cables).toHaveLength(2)
    expect(notes.some((n) => n.kind === 'approximate' && n.detail.includes('summed and centred'))).toBe(true)
    expect(notes.filter((n) => n.kind === 'dropped-cable')).toHaveLength(1)
  })

  it('says that a mapped sequencer arrives empty', () => {
    // SEQ3 is the one mapped model whose content is entirely knobs, and knobs do not come across. Wired and
    // silent reads as a broken import unless something says otherwise.
    const { notes } = importVcvPatch(
      JSON.stringify({ modules: [{ id: 1, plugin: 'Fundamental', model: 'SEQ3' }], cables: [] }),
    )!
    expect(notes.some((n) => n.kind === 'approximate' && n.detail.includes('empty'))).toBe(true)
  })

  it('carries a bypassed module across bypassed', () => {
    // v2 writes `bypassed` and v1 wrote `disabled`. A module somebody had switched out of the chain should
    // not come back in with the rest.
    const { patch } = importVcvPatch(
      JSON.stringify({
        modules: [
          { id: 1, plugin: 'Fundamental', model: 'VCO', bypassed: true },
          { id: 2, plugin: 'Fundamental', model: 'Delay', disabled: true },
          { id: 3, plugin: 'Bogaudio', model: 'Wavefolder', bypassed: true },
          { id: 4, plugin: 'Fundamental', model: 'VCA' },
        ],
        cables: [],
      }),
    )!
    expect(patch.modules.map((m) => m.bypassed)).toEqual([true, true, true, undefined])
    expect(decodePatch(encodePatch(patch))).toEqual(patch)
  })

  it('reads a MIDI module’s channel count as voices', () => {
    // A count is a count — not a value in somebody else’s units — which is why this is not the knob
    // decision in disguise. Polyphony landed after this importer did, so before it every import was mono.
    const poly = importVcvPatch(
      JSON.stringify({
        modules: [{ id: 1, plugin: 'Core', model: 'MIDIToCVInterface', data: { channels: 4 } }],
        cables: [],
      }),
    )!
    expect(poly.patch.voices).toBe(4)

    // Clamped to what this rack will build, and said so.
    const wide = importVcvPatch(
      JSON.stringify({
        modules: [{ id: 1, plugin: 'Core', model: 'MIDIToCVInterface', data: { channels: 16 } }],
        cables: [],
      }),
    )!
    expect(wide.patch.voices).toBe(8)
    expect(wide.notes.some((n) => n.kind === 'approximate' && n.detail.includes('maximum'))).toBe(true)

    // And anything unexpected leaves the patch monophonic, which is what every import did before this.
    for (const data of [undefined, {}, { channels: 'four' }, { channels: 1 }, { channels: 0 }, { channels: 99 }, 7]) {
      const { patch } = importVcvPatch(
        JSON.stringify({
          modules: [{ id: 1, plugin: 'Core', model: 'MIDIToCVInterface', data }],
          cables: [],
        }),
      )!
      expect(patch.voices, JSON.stringify(data)).toBeUndefined()
    }
  })

  it('keeps a module it has never heard of, with its cables', async () => {
    // The placeholder rule, built in compile.ts for version skew between two builds of this rack, turns out to
    // be exactly what importing somebody else's rack needs.
    const text = JSON.stringify({
      modules: [
        { id: 1, plugin: 'Fundamental', model: 'VCO' },
        { id: 2, plugin: 'Bogaudio', model: 'Wavefolder' },
        { id: 3, plugin: 'Core', model: 'AudioInterface' },
      ],
      cables: [
        { outputModuleId: 1, outputId: 2, inputModuleId: 2, inputId: 0 },
        { outputModuleId: 2, outputId: 0, inputModuleId: 3, inputId: 0 },
      ],
    })
    const { patch, notes } = importVcvPatch(text)!

    expect(patch.modules.map((m) => m.type)).toEqual(['vco', 'vcv:Bogaudio/Wavefolder', 'out'])
    // Both cables survive: the placeholder's ports are taken on trust, which is what a placeholder is for.
    expect(patch.cables).toHaveLength(2)
    expect(notes.some((n) => n.kind === 'placeholder' && n.detail.includes('Wavefolder'))).toBe(true)

    // And it round-trips, so opening a Rack patch and saving it does not demolish the parts we cannot play.
    expect(decodePatch(encodePatch(patch))).toEqual(patch)

    const plan = compile(patch, MODULES)
    expect(plan.notes.filter((n) => n.kind === 'placeholder')).toHaveLength(1)
  })

  it('reports a cable whose port has no equivalent rather than guessing', () => {
    // A wrong guess wires a filter's cutoff to an oscillator's saw and sounds subtly wrong forever. A dropped
    // cable is one line somebody can read.
    const text = JSON.stringify({
      modules: [
        { id: 1, plugin: 'Fundamental', model: 'VCO' },
        { id: 2, plugin: 'Fundamental', model: 'VCF' },
      ],
      // VCF input 3 maps to null in the table — we have no equivalent for it.
      cables: [{ outputModuleId: 1, outputId: 0, inputModuleId: 2, inputId: 3 }],
    })
    const { patch, notes } = importVcvPatch(text)!
    expect(patch.cables).toEqual([])
    expect(notes.filter((n) => n.kind === 'dropped-cable')).toHaveLength(1)
  })

  it('carries module positions across', () => {
    const { patch } = importVcvPatch(
      JSON.stringify({ modules: [{ id: 1, plugin: 'Fundamental', model: 'VCO', pos: [3, 4] }], cables: [] }),
    )!
    expect(patch.modules[0].pos).toEqual([3, 4])
  })

  it('lands the modules in the order they were on screen, not the order they were saved in', () => {
    // Our layout IS the module list, and VCV's array is creation order — so a rack built left to right over
    // an evening used to arrive shuffled. Row first, then x.
    const { patch } = importVcvPatch(
      JSON.stringify({
        modules: [
          { id: 1, plugin: 'Fundamental', model: 'VCA', pos: [30, 1] },
          { id: 2, plugin: 'Fundamental', model: 'VCO', pos: [10, 0] },
          { id: 3, plugin: 'Fundamental', model: 'VCF', pos: [2, 1] },
          { id: 4, plugin: 'Fundamental', model: 'ADSR' },
          { id: 5, plugin: 'Fundamental', model: 'Delay', pos: [0, 0] },
        ],
        cables: [],
      }),
    )!
    expect(patch.modules.map((m) => m.type)).toEqual(['delay', 'vco', 'svf', 'vca', 'adsr'])
  })

  it('carries no knob positions, deliberately', () => {
    // Topology only. A VCV param is a number whose meaning lives in that module's C++, so carrying one over
    // means encoding a guess about somebody else's internals — and a cutoff silently a factor of ten out is
    // worse than a knob at our default.
    const { patch } = importVcvPatch(
      JSON.stringify({
        modules: [{ id: 1, plugin: 'Fundamental', model: 'VCO', params: [{ id: 0, value: 0.731 }] }],
        cables: [],
      }),
    )!
    expect(patch.modules[0].params).toBeUndefined()
  })

  it('gives every module a distinct id even with several of a kind', () => {
    const { patch } = importVcvPatch(
      JSON.stringify({
        modules: [
          { id: 1, plugin: 'Fundamental', model: 'VCO' },
          { id: 2, plugin: 'Fundamental', model: 'VCO' },
          { id: 3, plugin: 'Nope', model: 'Nope' },
          { id: 4, plugin: 'Nope', model: 'Nope' },
        ],
        cables: [],
      }),
    )!
    expect(new Set(patch.modules.map((m) => m.id)).size).toBe(4)
    expect(patch.modules.map((m) => m.id)).toEqual(['vco-1', 'vco-2', 'vcv-1', 'vcv-2'])
  })

  it('survives a patch.json that is not one', () => {
    for (const junk of ['', 'null', '[]', '{}', '{"modules":7}', 'not json']) {
      expect(importVcvPatch(junk)).toBeNull()
    }
  })

  it('ignores cables pointing at modules that are not there', () => {
    const { patch } = importVcvPatch(
      JSON.stringify({
        modules: [{ id: 1, plugin: 'Fundamental', model: 'VCO' }],
        cables: [{ outputModuleId: 1, outputId: 0, inputModuleId: 99, inputId: 0 }, null, 7],
      }),
    )!
    expect(patch.cables).toEqual([])
  })

  it('says what was in an archive that had no patch.json', async () => {
    const result = await importVcv(await zip([{ name: 'notes.txt', body: 'hello', stored: true }]))
    expect(result?.notes[0]).toMatchObject({ kind: 'refused' })
    expect(result?.notes[0].detail).toContain('notes.txt')
  })

  it('is null for a file that is not an archive at all', async () => {
    expect(await importVcv(new TextEncoder().encode('nope').buffer as ArrayBuffer)).toBeNull()
  })
})

describe('the mapping table', () => {
  it('only ever names modules this build has', () => {
    // A mapping to a type that does not exist would produce a placeholder while claiming to be a match, which
    // is the one outcome worse than not mapping at all.
    for (const slug of VCV_MODELS) {
      const { patch } = importVcvPatch(
        JSON.stringify({
          modules: [{ id: 1, plugin: slug.split('/')[0], model: slug.split('/')[1] }],
          cables: [],
        }),
      )!
      expect(MODULES[patch.modules[0].type], slug).toBeDefined()
    }
  })

  it('only ever names ports those modules have', () => {
    // The indices are unverified; the port *names* must at least exist, or a cable that maps successfully still
    // gets dropped by the compiler and the report would say two contradictory things.
    for (const slug of VCV_MODELS) {
      const [plugin, model] = slug.split('/')
      // Fire a cable at every plausible index and check nothing lands on a port we do not have.
      for (let index = 0; index < 8; index++) {
        const { patch } = importVcvPatch(
          JSON.stringify({
            modules: [
              { id: 1, plugin, model },
              { id: 2, plugin, model },
            ],
            cables: [{ outputModuleId: 1, outputId: index, inputModuleId: 2, inputId: index }],
          }),
        )!
        for (const cable of patch.cables) {
          const def = MODULES[patch.modules[0].type]
          expect(def.outlets.some((p) => p.id === cable.from[1]), `${slug} out ${cable.from[1]}`).toBe(true)
          expect(def.inlets.some((p) => p.id === cable.to[1]), `${slug} in ${cable.to[1]}`).toBe(true)
        }
      }
    }
  })
})
