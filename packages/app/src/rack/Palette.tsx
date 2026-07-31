import type { Chunk, ModuleLogo as ModuleLogoDef } from '@driftbox/rack'
import { useEffect, useMemo, useRef, useState } from 'react'
import { browse } from './browse.js'
import { portSummary } from './layout.js'

// Choosing something to add.
//
// **The flat list this replaces was the single biggest thing between the rack and somebody enjoying it.**
// Twenty-eight names in a row — `Offset`, `S&H`, `Alligator`, `Combi` — assume you already know what they
// are, which is exactly what a person opening a modular for the first time does not. Reason's browser was
// a picture and a sentence per device for the same reason: the picker is where you find out what the
// instrument can do, so a picker that only names things teaches nothing and the rack stays a puzzle.
//
// So: a card per thing, with a sentence saying what it is and why you would reach for it, shelved by what
// it does. Three decisions in that worth stating.
//
// **The copy lives on the module def, not here.** `ModuleDef.blurb` explains at length; the short of it is
// that the registry's promise is "adding a module is a class, a def and a test", and copy in the host would
// have made it "a class, a def, a test, and an edit to a file in another package".
//
// **The shelves come from the defs too**, and the list is walked once rather than grouped by a `Map` — so
// the order *within* a shelf stays whatever `MODULE_LIST` says, which is deliberate (a VCO before a
// Sampler, a Transport before a Clock) and a sort would throw away.
//
// **Chunks first, and unshelved.** They are what somebody starting a track actually wants, and a bare VCO
// is not — the same reasoning that put them first in the old list, and the same reasoning Reason had for
// offering devices and Combi patches from one browser.
//
// The filter is one input over both, matching name and blurb, because "I want something that makes it
// wobble" is a real way to look for an LFO and browsing seven shelves for it is not.

interface Props {
  onModule: (type: string) => void
  onChunk: (chunk: Chunk) => void
}

function ModuleLogo({ logo }: { logo: ModuleLogoDef }) {
  return (
    <span className="rk-card-logo" aria-hidden="true">
      <svg viewBox="0 0 64 40" focusable="false">
        {logo.paths.map((path, index) => (
          <path key={index} d={path} />
        ))}
      </svg>
    </span>
  )
}

export function Palette({ onModule, onChunk }: Props) {
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)

  // Focused on open, because the picker is a place you arrive at knowing roughly what you want, and
  // typing is the fastest way to say it. Safe to steal: the panel only exists because somebody pressed
  // Add module a moment ago, so there is nothing else they could have meant to be typing into.
  useEffect(() => {
    search.current?.focus()
  }, [])

  const { chunks, shelves } = useMemo(() => browse(query), [query])
  const empty = chunks.length === 0 && shelves.length === 0

  return (
    <div className="rk-palette">
      <div className="rk-palette-search">
        <input
          ref={search}
          type="search"
          value={query}
          placeholder="Search modules…"
          aria-label="Search modules"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {chunks.length > 0 && (
        <section className="rk-shelf">
          <h2>Chunks</h2>
          {/* Marked as chunks rather than merely listed first: dropping one adds several modules, some
              cables and its own channel, which is a bigger thing to have happen than adding a VCO and
              should not look identical to it. */}
          <p className="rk-shelf-note">Pre-wired groups, each on its own channel.</p>
          <div className="rk-cards">
            {chunks.map((chunk) => (
              <button
                key={chunk.id}
                type="button"
                className="rk-card rk-card-chunk"
                onClick={() => onChunk(chunk)}
              >
                <span className="rk-card-name">{chunk.name}</span>
                <span className="rk-card-blurb">{chunk.blurb}</span>
                <span className="rk-card-ports">
                  {chunk.modules.length} modules{chunk.needsSample ? ' · needs a break' : ''}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {shelves.map((shelf) => (
        <section key={shelf.group} className="rk-shelf">
          <h2>{shelf.group}</h2>
          <div className="rk-cards">
            {shelf.modules.map((def) => (
              <button
                key={def.type}
                type="button"
                className="rk-card"
                data-group={def.group}
                onClick={() => onModule(def.type)}
              >
                <span className="rk-card-top">
                  {def.logo && <ModuleLogo logo={def.logo} />}
                  <span className="rk-card-copy">
                    <span className="rk-card-name">{def.name}</span>
                    <span className="rk-card-blurb">{def.blurb}</span>
                  </span>
                </span>
                <span className="rk-card-ports">{portSummary(def)}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {/* Said out loud, because an empty panel reads as broken rather than as a search with no hits. */}
      {empty && <p className="rk-shelf-note">Nothing matches “{query}”.</p>}
    </div>
  )
}
