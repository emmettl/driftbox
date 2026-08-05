import type { DocumentNotice as Notice } from './document-notice.js'

/**
 * What this document is, when it is not simply a rack patch.
 *
 * Shown above everything else because it changes what the rest of the page means: the patterns playing
 * are retained rather than rack-authored, and the Sequencer link is a door back to where they came from.
 * Renders nothing for a rack-native patch — see `documentNotice`, which returns null there.
 */
export function DocumentNotice({ notice }: { notice: Notice | null }) {
  if (!notice) return null
  return (
    <p className="rk-document">
      <strong>{notice.compatibility}</strong>
      {' · '}
      {notice.retained}
      {' · '}
      {notice.guidance}
    </p>
  )
}
