import type { RackWarning } from './warnings.js'

/**
 * The stack of sentences under the header: the link just copied, and everything that is not quite right.
 *
 * Deliberately dumb. Every decision about *whether* a line appears and what it says is `rackWarnings`,
 * which is a function and therefore something a test can hold a claim against; this only puts the answer
 * on the page. The two live together because they are read together — a share link that cannot carry
 * somebody's sample is the link and the warning about it, one above the other.
 */
export function RackWarnings({
  shared,
  warnings,
}: {
  /** The link made by the last Copy link, if there has been one. */
  shared: string | null
  warnings: readonly RackWarning[]
}) {
  return (
    <>
      {shared && <p className="rk-shared">{shared}</p>}
      {warnings.map((warning) => (
        <p className="rk-warn" key={warning.id}>
          {warning.text}
        </p>
      ))}
    </>
  )
}
