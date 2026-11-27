import Link from 'next/link';
import type { ReactNode } from 'react';

import { Arrow } from '@/components/art/Mark';
import { Ticket } from '@/components/art/Ticket';
import { KEY_LIMITS, TIER_FACTS } from '@/content/product';
import { TIER_INK, windowLabel } from '@/lib/i18n';
import type { SitePage } from '@/lib/site';

/** A section opens with a heavy rule, its title, and the ink patch and page it belongs to. */
export function SectionHead({
  id,
  title,
  ink = 'ink',
  tag,
}: {
  id: string;
  title: string;
  ink?: SitePage['ink'] | 'ochre';
  tag?: string;
}) {
  return (
    <>
      <hr className="rule" data-reveal="rule" />
      <div className="sec-head" data-ink={ink}>
        <h2 id={id} className="h2">
          {title}
        </h2>
        {tag ? (
          <span className="sec-head__tag label">
            <i className="patch" aria-hidden="true" />
            {tag}
          </span>
        ) : null}
      </div>
    </>
  );
}

/** "Continued on page N": every teaser on the home page ends with one. */
export function Continued({
  href,
  page,
  children,
}: {
  href: string;
  page: number;
  children: ReactNode;
}) {
  return (
    <Link href={href} className="more">
      {children}, page {page}
      <Arrow />
    </Link>
  );
}

/** A page opens with one huge word, its patch and its page number. */
export function PageOpener({
  word,
  ink,
  page,
  lead,
  children,
}: {
  word: string;
  ink: SitePage['ink'];
  page: number;
  lead: string;
  children?: ReactNode;
}) {
  return (
    <header className="opener-block wrap" data-ink={ink}>
      <p className="opener-block__tag label">
        <i className="patch" aria-hidden="true" />
        Page {page}
      </p>
      <h1 className="opener" data-reveal="rise">
        <span>{word}</span>
      </h1>
      <hr className="rule" data-reveal="rule" />
      <div className="opener-block__lead">
        <p className="lead">{lead}</p>
        {children}
      </div>
    </header>
  );
}

/**
 * The five tiers as five tickets, each printed in its own ink and punched at
 * the hour its window ends. The windows are the SDK's policy table.
 */
export function TierTickets() {
  return (
    <ol className="tier-strip" aria-label="Undo window by risk tier">
      {TIER_FACTS.map((fact, index) => {
        const text = windowLabel(fact.windowSecs, 'en');
        const [figure, ...unit] = fact.windowSecs === 0 ? ['0'] : text.split(' ');
        return (
          <li key={fact.tier} data-reveal="slide" style={{ ['--i' as string]: index }}>
            <Ticket
              ink={TIER_INK[fact.tier]}
              windowSecs={fact.windowSecs}
              serial={`Tier ${index}`}
              amount={figure ?? '0'}
              unit={fact.windowSecs === 0 ? 'WAIT' : unit.join(' ').toUpperCase()}
              blockNote="Undo window"
              gridLabel="Hours you can take it back"
              tierLabel={fact.tier}
              windowText={text}
              footLine={fact.extra ? `72 hours ${fact.extra}.` : 'Set by policy, not by a person.'}
              title={`${fact.plain} (${fact.tier}): ${text}${fact.extra ? `, ${fact.extra}` : ''}`}
            />
            <p className="tier-strip__plain">{fact.plain}</p>
            <p className="small quiet">{fact.when}</p>
          </li>
        );
      })}
    </ol>
  );
}

/** What each service key can and cannot do. The limits are enforced by the program. */
export function KeyTable() {
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">Can</th>
            <th scope="col">Cannot</th>
          </tr>
        </thead>
        <tbody>
          {KEY_LIMITS.map((row) => (
            <tr key={row.key}>
              <td>{row.key}</td>
              <td>{row.can}</td>
              <td>{row.cannot}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
