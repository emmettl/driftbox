/**
 * The one-time offer of a guided tour.
 *
 * Offered once, on the first visit this browser has ever made, and never again whichever button answers
 * it. The rack opens on a finished arrangement playing itself, which is the right first impression and a
 * poor first instruction — it shows what the instrument can do and nothing about what your hands are for.
 *
 * Two buttons rather than a dismissible hint, because "not now" is a real answer and a hint you have to
 * find the × on is not a question.
 */
export function TourOffer({
  onStart,
  onDecline,
}: {
  onStart: () => void
  onDecline: () => void
}) {
  return (
    <p className="rk-tour-offer">
      <strong>First time in the rack?</strong>
      <span>A three-minute guided tour ends with a sound you made. It never touches the rack itself.</span>
      <button type="button" className="rk-primary" onClick={onStart}>
        Start the tour
      </button>
      <button type="button" onClick={onDecline}>
        Not now
      </button>
    </p>
  )
}
