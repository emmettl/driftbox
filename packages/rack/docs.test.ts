import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MODULE_LIST } from './src/modules/index.js'

// The module count, pinned in the four places that state it.
//
// **This exists because those four places said three different numbers.** The package README
// and `docs/RACK.md` both claimed thirty-seven, `RACK.md`'s own section heading claimed
// forty-four, and the registry held forty-seven — so the README that ships inside the npm
// tarball understated the package by ten modules. Nothing broke, which is exactly the problem:
// a count is prose, and prose does not fail a build when the thing it describes grows.
//
// Adding a module is meant to stay cheap — `docs/RACK.md` step 3 makes the case that it should
// be a class, a def and a test. This does not change that. It makes the *documentation* part of
// adding a module a failing test rather than a thing to remember, which is the same argument
// `REASON-GAP.md` makes about its own gap list: one that goes stale is worse than none, because
// it argues for work that is already done.

const doc = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/** `48` → `forty-eight`. Under a hundred, which is well past where this list should stop. */
function spell(n: number): string {
  const units = [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
    'nineteen',
  ]
  const tens = [
    '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
  ]
  if (n < 20) return units[n]
  const unit = n % 10
  return unit === 0 ? tens[(n / 10) | 0] : `${tens[(n / 10) | 0]}-${units[unit]}`
}

const capitalise = (s: string) => s[0].toUpperCase() + s.slice(1)

describe('the module count in the docs', () => {
  const count = MODULE_LIST.length

  it('matches the section heading in RACK.md, and the table under it', () => {
    const rack = doc('../../docs/RACK.md')

    expect(rack).toContain(`## ${capitalise(spell(count))} modules`)

    // The table itself, not just the heading — a heading can be corrected while the row it
    // was counting is still missing, which is how `Wavetable` and `Line Mixer` went unlisted.
    const heading = rack.indexOf(`## ${capitalise(spell(count))} modules`)
    const table = rack.slice(heading, rack.indexOf('\n## ', heading + 1))
    expect(table.match(/^\| \*\*/gm) ?? []).toHaveLength(count)
  })

  it('matches the prose count in RACK.md, the package README and the roadmap', () => {
    expect(doc('../../docs/RACK.md')).toContain(`${count} modules`)
    expect(doc('./README.md')).toContain(`${capitalise(spell(count))} modules`)
    expect(doc('../../ROADMAP.md')).toContain(`${count} modules`)
  })
})
