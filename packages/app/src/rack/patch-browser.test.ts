import { decodeSong, emptyPattern, defaultKit, type Song } from '@driftbox/engine'
import { embedGrooveboxSong, type Imported, type Patch } from '@driftbox/rack'
import { describe, expect, it, vi } from 'vitest'
import type { SavedDocument } from '../document-library.js'
import {
  PROBLEMS,
  adoptDocument,
  deleteQuestion,
  entryAction,
  meterCount,
  nameAfterDelete,
  nameAfterRename,
  presetAction,
  presetSummary,
  presetTempo,
  saveAsName,
  saveTarget,
  vcvOutcome,
  type Dialogs,
} from './patch-browser.js'

// "Save as…" was untestable by construction rather than by accident: a `prompt()` and a `confirm()` sat
// in the middle of its own logic, so its five branches could only be reached by a person clicking a modal
// five times. With the dialogs as ports they are five assertions.

const shelf = (...names: [string, SavedDocument['kind']][]): SavedDocument[] =>
  names.map(([name, kind]) => ({
    name,
    kind,
    compatibility: kind === 'song' ? 'groovebox-compatible' : 'rack-native',
    text: '',
  }))

const dialogs = (answers: { ask?: string | null; confirm?: boolean }): Dialogs => ({
  ask: vi.fn(() => answers.ask ?? null),
  confirm: vi.fn(() => answers.confirm ?? false),
})

const fresh = (base: string) => `${base} 2`

const patch = (over: Partial<Patch> = {}): Patch => ({
  modules: [{ id: 'v', type: 'voice' }, { id: 'out', type: 'out' }],
  cables: [{ from: ['v', 'out'], to: ['out', 'in'] }],
  ...over,
})

const song = (): Song => ({
  bpm: 130,
  swing: 0.5,
  patterns: [emptyPattern('a', 'A')],
  chain: [{ pattern: 'a', repeat: 1 }],
  kit: defaultKit(['808.bd']),
})

describe('where a plain save writes', () => {
  it('writes back to the document it came from', () => {
    expect(saveTarget('Fanfare', fresh)).toBe('Fanfare')
  })

  it('invents a name for an untitled rack rather than asking for one', () => {
    // The button says "Save patch"; a dialog appearing when it is pressed is what "Save as…" is for.
    expect(saveTarget(null, fresh)).toBe('Patch 2')
  })
})

describe('save as', () => {
  it('offers a fresh name based on the open one', () => {
    const ports = dialogs({ ask: 'Anything' })
    saveAsName('Fanfare', [], ports, fresh)
    expect(ports.ask).toHaveBeenCalledWith('Save as', 'Fanfare 2')
  })

  it('offers one based on nothing when the rack is untitled', () => {
    const ports = dialogs({ ask: 'Anything' })
    saveAsName(null, [], ports, fresh)
    expect(ports.ask).toHaveBeenCalledWith('Save as', 'Patch 2')
  })

  it('takes the name it was given', () => {
    expect(saveAsName(null, [], dialogs({ ask: 'Bassline' }), fresh)).toBe('Bassline')
  })

  it('trims it, because a trailing space is not a different patch', () => {
    expect(saveAsName(null, [], dialogs({ ask: '  Bassline  ' }), fresh)).toBe('Bassline')
  })

  it('writes nothing when the prompt is dismissed', () => {
    expect(saveAsName(null, [], dialogs({ ask: null }), fresh)).toBeNull()
  })

  it('treats an empty answer, and one that is only spaces, as a refusal', () => {
    expect(saveAsName(null, [], dialogs({ ask: '' }), fresh)).toBeNull()
    expect(saveAsName(null, [], dialogs({ ask: '   ' }), fresh)).toBeNull()
  })

  it('asks before writing over a document already on the shelf, naming its kind', () => {
    const ports = dialogs({ ask: 'Fanfare', confirm: true })
    expect(saveAsName(null, shelf(['Fanfare', 'song']), ports, fresh)).toBe('Fanfare')
    expect(ports.confirm).toHaveBeenCalledWith('Replace “Fanfare” (song)?')
  })

  it('writes nothing when that question is declined', () => {
    const ports = dialogs({ ask: 'Fanfare', confirm: false })
    expect(saveAsName(null, shelf(['Fanfare', 'patch']), ports, fresh)).toBeNull()
  })

  it('does not ask about a name nothing on the shelf is using', () => {
    const ports = dialogs({ ask: 'Something else' })
    expect(saveAsName(null, shelf(['Fanfare', 'patch']), ports, fresh)).toBe('Something else')
    expect(ports.confirm).not.toHaveBeenCalled()
  })

  it('asks against the shelf even when the name is the open document', () => {
    // Saving over the one already open is what the other button does; this one still confirms.
    const ports = dialogs({ ask: 'Fanfare', confirm: true })
    expect(saveAsName('Fanfare', shelf(['Fanfare', 'patch']), ports, fresh)).toBe('Fanfare')
    expect(ports.confirm).toHaveBeenCalledOnce()
  })
})

describe('what the open document is called afterwards', () => {
  it('follows a rename of the file it is', () => {
    expect(nameAfterRename('Fanfare', 'Fanfare', 'Overture')).toBe('Overture')
    expect(nameAfterRename('Fanfare', 'Fanfare', '  Overture  ')).toBe('Overture')
  })

  it('ignores a rename of any other file', () => {
    // Otherwise the header claims to be a patch it is not, and the next save writes to the wrong one.
    expect(nameAfterRename('Fanfare', 'Something else', 'Overture')).toBe('Fanfare')
    expect(nameAfterRename(null, 'Something else', 'Overture')).toBeNull()
  })

  it('becomes untitled when the file behind it is deleted', () => {
    expect(nameAfterDelete('Fanfare', 'Fanfare')).toBeNull()
  })

  it('is untouched by deleting anything else', () => {
    expect(nameAfterDelete('Fanfare', 'Something else')).toBe('Fanfare')
  })

  it('names the document in the question before it is thrown away', () => {
    expect(deleteQuestion('Fanfare')).toBe('Delete “Fanfare”?')
  })
})

describe('opening something from the shelf', () => {
  it('opens a patch as itself', () => {
    const saved = patch()
    expect(adoptDocument({ kind: 'patch', patch: saved })).toBe(saved)
  })

  it('carries a saved song across whole, rather than exploding it into modules', () => {
    const adopted = adoptDocument({ kind: 'song', song: song() })
    // The authored song survives the trip, which is the product boundary this bridge exists to keep.
    expect(decodeSong(adopted.groovebox ?? '')?.patterns[0].id).toBe('a')
    expect(adopted.modules.some((module) => module.type === 'groovebox')).toBe(true)
  })
})

describe('what a shelf entry offers', () => {
  it('says so rather than offering to load itself again', () => {
    expect(entryAction(shelf(['Fanfare', 'patch'])[0], 'Fanfare')).toBe('Open now')
  })

  it('says a song is a song, because loading one brings an arrangement with it', () => {
    expect(entryAction(shelf(['Fanfare', 'song'])[0], null)).toBe('Load song →')
  })

  it('reports the compatibility a patch will open at, readably', () => {
    // That is the one thing deciding whether it can go back to the sequencer afterwards.
    expect(entryAction(shelf(['Fanfare', 'patch'])[0], null)).toBe('rack native →')
    const extended: SavedDocument = {
      name: 'Wired',
      kind: 'patch',
      compatibility: 'rack-extended',
      text: '',
    }
    expect(entryAction(extended, null)).toBe('rack extended →')
  })
})

describe('what a factory card says', () => {
  it('marks the one already open', () => {
    expect(presetAction('Fanfare', 'Fanfare')).toBe('open')
    expect(presetAction('Fanfare', 'Something else')).toBe('load →')
    expect(presetAction('Fanfare', null)).toBe('load →')
  })

  it('counts what it is about to put in the rack', () => {
    expect(presetSummary(patch())).toBe('2 modules · 1 cables')
  })

  it('mentions a tempo only when there is one to mention', () => {
    // A patch shared at the wrong tempo is not the patch that was shared; one with no opinion says so
    // by staying quiet rather than by printing a zero.
    expect(presetSummary(patch({ tempo: 174 }))).toBe('2 modules · 1 cables · 174 bpm')
    expect(presetSummary(patch({ tempo: 0 }))).toBe('2 modules · 1 cables')
    expect(presetTempo(patch())).toBeUndefined()
  })

  it('falls back to the retained song, which is where a song patch keeps its tempo', () => {
    // A song patch carries no tempo of its own — it leaves the song in charge rather than overriding
    // it — so reading only `patch.tempo` would leave every Rack++ song card claiming no tempo at all.
    const carried = embedGrooveboxSong({ ...song(), bpm: 174 })
    expect(presetTempo(carried)).toBe(174)
    expect(presetSummary(carried)).toContain('· 174 bpm')
  })

  it('lets an explicit tempo win over the song it carries', () => {
    const carried = embedGrooveboxSong({ ...song(), bpm: 174 })
    expect(presetTempo({ ...carried, tempo: 130 })).toBe(130)
  })

  it('counts the meters its fake VU display shows', () => {
    expect(meterCount(patch())).toBe(0)
    expect(
      meterCount(patch({ modules: [{ id: 'm', type: 'meter' }, { id: 'n', type: 'meter' }] })),
    ).toBe(2)
  })
})

describe('importing a VCV patch', () => {
  const notes: Imported['notes'] = [{ kind: 'mapped', detail: 'VCO-1 → vco' }]

  it('rejects a file that is not one', () => {
    expect(vcvOutcome(null)).toEqual({ kind: 'rejected', problem: PROBLEMS.vcv })
  })

  it('loads a patch it understood, with the report', () => {
    const imported = patch()
    expect(vcvOutcome({ patch: imported, notes })).toEqual({
      kind: 'loaded',
      patch: imported,
      notes,
    })
  })

  it('keeps the rack when it understood the file but mapped nothing', () => {
    // A patch made entirely of modules this rack has no answer for parses fine and imports nothing.
    // Replacing the open rack with an empty one would be the worst possible response.
    expect(vcvOutcome({ patch: { modules: [], cables: [] }, notes })).toEqual({
      kind: 'empty',
      notes,
    })
  })
})
