import type { Metadata } from 'next';
import Link from 'next/link';

import { Ticket } from '@/components/art/Ticket';
import { describePayAction } from '@/lib/actions/pay';
import { ActionFailure } from '@/lib/actions/spec';
import { publicEnv } from '@/lib/env';
import { shortAddress } from '@/lib/format';
import { serverGuardian } from '@/lib/guardian.server';
import { serverConnection } from '@/lib/solana.server';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pay' };

/** What the request is in: SOL unless a mint is named; devnet USDC is known by name. */
function payUnit(mint: string | null): string {
  if (!mint || mint === 'SOL') return 'SOL';
  return mint === 'USDC' ? 'USDC' : 'TOKEN';
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The shareable "pay me" link. Blink-aware clients turn this URL into the
 * Action at /api/actions/pay (see /actions.json); everyone else lands here and
 * sees the same description, set as a payment request slip with one button.
 * Data: `describePayAction`.
 */
export default async function PayPage({ searchParams }: Props) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') query.set(key, value);
  }
  const url = new URL(`/pay?${query.toString()}`, publicEnv.siteUrl);
  const to = query.get('to');
  const amount = query.get('amount');

  try {
    const action = await describePayAction(url, {
      guardian: serverGuardian(),
      connection: serverConnection(),
      cluster: publicEnv.cluster,
    });
    return (
      <main className="pay wrap">
        {to ? (
          <div className="pay__ticket" aria-hidden="true">
            <Ticket
              ink="blue"
              windowSecs={0}
              serial={shortAddress(to)}
              amount={/^\d+(\.\d+)?$/.test(amount ?? '') ? (amount as string) : '?'}
              unit={payUnit(query.get('mint'))}
              blockNote="Requested"
              gridLabel="Hours you can take it back"
              tierLabel="Not punched yet"
              windowText="Set when you pay"
              footLine="The risk agent punches it when you review."
              title=""
            />
          </div>
        ) : null}
        <div className="slip">
          <p className="label slip__kicker">Payment request</p>
          <h1 className="h2">{action.title}</h1>
          <hr className="rule" />
          <p className="lead slip__text">{action.description}</p>
          {to ? (
            <dl className="kv">
              <div className="kv__row">
                <dt>Pay to</dt>
                <dd className="mono">{to}</dd>
              </div>
            </dl>
          ) : null}
          {action.error ? (
            <p className="notice" data-ink="red" role="alert">
              {action.error.message}
            </p>
          ) : null}
          {action.disabled ? null : (
            <div className="btn-row slip__actions">
              <Link href={`/app?${query.toString()}`} className="btn">
                {action.label}
              </Link>
            </div>
          )}
          <hr className="perf" />
          <p className="small quiet">
            Paid through HOLDBACK on {publicEnv.cluster}: the money is held on-chain for an undo
            window sized from the evidence about this recipient. You review the verdict before you
            sign anything.
          </p>
        </div>
      </main>
    );
  } catch (failure) {
    if (!(failure instanceof ActionFailure)) throw failure;
    return (
      <main className="pay wrap">
        <div className="slip">
          <p className="label slip__kicker">Payment request</p>
          <h1 className="h2">This payment link cannot be used</h1>
          <hr className="rule" />
          <p className="notice" data-ink="red" role="alert">
            {failure.message}
          </p>
          <div className="btn-row slip__actions">
            <Link href="/app" className="btn btn--ghost">
              Open the app instead
            </Link>
          </div>
        </div>
      </main>
    );
  }
}
