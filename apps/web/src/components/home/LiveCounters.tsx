'use client';

import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';

import type { LiveStatsResult } from '@/lib/stats';

const LiveStatsFeed = dynamic(() => import('./LiveStatsFeed'), { ssr: false });

type Status = 'loading' | 'ready' | 'unavailable';

const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function updatedLabel(iso: string): string {
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return '';
  return `${time.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * The public counters, set like the figures row of a ledger. Three honest
 * states: real numbers with their source and time; zeros with a line saying
 * nothing has been recorded yet; and, when neither the agent nor the database
 * answers, one line saying so and no figures. A number is never made up.
 */
export function LiveCounters({ initial }: { initial: LiveStatsResult | null }) {
  const [result, setResult] = useState(initial);
  const [status, setStatus] = useState<Status>(initial ? 'ready' : 'loading');
  const onChange = useCallback((next: LiveStatsResult | null, nextStatus: Status) => {
    setResult(next);
    setStatus(nextStatus);
  }, []);

  const stats = result?.stats ?? null;
  const cells: { label: string; value: string; raw: number }[] = stats
    ? [
        { label: 'Holds opened', value: whole.format(stats.holdsCreated), raw: stats.holdsCreated },
        {
          label: 'Taken back',
          value: whole.format(stats.holdsReclaimed),
          raw: stats.holdsReclaimed,
        },
        { label: 'Released', value: whole.format(stats.holdsReleased), raw: stats.holdsReleased },
        {
          label: 'Value held, USD',
          value: usd.format(stats.valueProtectedUsd),
          raw: Math.round(stats.valueProtectedUsd),
        },
      ]
    : [];
  const empty = stats !== null && stats.holdsCreated === 0;

  return (
    <section className="counters wrap" aria-labelledby="counters-title">
      <hr className="rule" data-reveal="rule" />
      <div className="counters__head">
        <h2 id="counters-title" className="label">
          {stats ? 'Live on devnet' : 'Counters'}
        </h2>
        <p className="small quiet" role="status">
          {stats
            ? `From the ${result?.source === 'agent' ? 'risk agent' : 'database'}, ${updatedLabel(stats.updatedAt)}`
            : status === 'loading'
              ? 'Asking the risk agent for the counters.'
              : 'Unavailable right now: neither the risk agent nor the database answered, so no numbers are shown.'}
        </p>
      </div>
      {/* Without data there is no row of figures at all: an empty cell reads as a zero. */}
      {stats ? (
        <dl className="ledger">
          {cells.map((cell) => (
            <div className="ledger__cell" key={cell.label}>
              <dt className="label">{cell.label}</dt>
              <dd className="num" data-count={cell.raw}>
                {cell.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {empty ? (
        <p className="ledger__note">
          No holds have been recorded yet. These are real counts, so they start at zero.
        </p>
      ) : null}
      <LiveStatsFeed initial={initial} onChange={onChange} />
    </section>
  );
}
