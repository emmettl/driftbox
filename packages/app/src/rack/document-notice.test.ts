import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DocumentNotice } from './DocumentNotice.js'
import { documentNotice, leavingWarning, sequencerTitle } from './document-notice.js'

// The promise the rack makes to somebody who arrived from the sequencer: your song is intact, and here is
// exactly what going back costs. It is a promise about data loss, so the wording is not decoration — a
// notice that said "returns without loss" over a rack-extended document would be inviting somebody to
// throw away work on the strength of a sentence this app wrote.

const SONG = { patterns: 8, bpm: 174 }

describe('a patch built here', () => {
  it('gets no notice at all', () => {
    expect(documentNotice('rack-native', null)).toBeNull()
    expect(renderToStaticMarkup(createElement(DocumentNotice, { notice: null }))).toBe('')
  })
})

describe('a song retained from the sequencer', () => {
  it('quotes what is retained, and promises a lossless return', () => {
    const notice = documentNotice('groovebox-compatible', SONG)
    expect(notice?.retained).toBe('8 patterns at 174 BPM retained exactly.')
    expect(notice?.guidance).toContain('returns without loss')
    expect(notice?.guidance).toContain('patch a Groovebox output')
  })

  it('says where rack-only work lives once there is some', () => {
    const notice = documentNotice('rack-extended', SONG)
    expect(notice?.guidance).toContain('keeps those rack additions saved here')
    // The two states must not share a sentence: this is the one that costs something.
    expect(notice?.guidance).not.toBe(documentNotice('groovebox-compatible', SONG)?.guidance)
  })
})

describe('a song from a build this one does not know', () => {
  it('claims preservation without claiming it can be edited or sent on', () => {
    const notice = documentNotice('groovebox-compatible', null)
    expect(notice?.retained).toContain('cannot be edited here')
    expect(notice?.guidance).toContain('will not send it to a sequencer that cannot decode it')
  })
})

describe('the notice on the page', () => {
  it('leads with the compatibility state itself', () => {
    const html = renderToStaticMarkup(
      createElement(DocumentNotice, { notice: documentNotice('rack-extended', SONG) }),
    )
    expect(html).toContain('<p class="rk-document">')
    expect(html).toContain('<strong>rack-extended</strong>')
    expect(html).toContain('8 patterns at 174 BPM')
  })
})

describe('the way back to the sequencer', () => {
  it('is unlabelled for a patch that was never a song', () => {
    expect(sequencerTitle('rack-native', false)).toBeUndefined()
  })

  it('promises the same thing in advance that the notice promises', () => {
    expect(sequencerTitle('groovebox-compatible', true)).toContain('Return to the sequencer')
    expect(sequencerTitle('rack-extended', true)).toContain('stay saved in rack mode')
  })

  it('only stops to confirm when leaving actually leaves something behind', () => {
    expect(leavingWarning('rack-native')).toBeNull()
    // Confirming a cost nobody is paying teaches people to dismiss the dialog that matters.
    expect(leavingWarning('groovebox-compatible')).toBeNull()
    expect(leavingWarning('rack-extended')).toContain('stay saved in rack mode')
  })
})
