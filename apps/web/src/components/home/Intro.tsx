import { TICKET_CELLS } from '@/components/art/Ticket';

/**
 * The opening: for a second and a half the screen is one large ticket. A
 * hole is punched in it, the page shows through the hole, and the hole grows
 * until the ticket is gone and the hero is what is left.
 *
 * Pure CSS, shown only when the head script has marked this as the first
 * page of a visit (`html.intro-run`) and motion is welcome. The page beneath
 * is fully rendered the whole time, so nothing waits on it.
 */
export function Intro() {
  return (
    <div className="intro" aria-hidden="true">
      <div className="intro__ticket">
        <p className="intro__head">
          <span className="wordmark">HOLDBACK</span>
          <span className="label">Devnet</span>
        </p>
        <ol className="intro__grid">
          {TICKET_CELLS.slice(0, 25).map((cell) => (
            <li key={cell}>{cell}</li>
          ))}
        </ol>
        <p className="intro__foot label">Hours you can take it back</p>
      </div>
    </div>
  );
}
