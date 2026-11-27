import type { Metadata } from 'next';

import { describePayAction } from '@/lib/actions/pay';
import { ActionFailure } from '@/lib/actions/spec';
import { publicEnv } from '@/lib/env';
import { serverGuardian } from '@/lib/guardian.server';
import { serverConnection } from '@/lib/solana.server';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pay' };

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Structure only, visual design pending.
//
// The shareable "pay me" link. Blink-aware clients turn this URL into the
// Action at /api/actions/pay (see /actions.json); everyone else lands here and
// sees the same description. Data: `describePayAction`.
export default async function PayPage({ searchParams }: Props) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') query.set(key, value);
  }
  const url = new URL(`/pay?${query.toString()}`, publicEnv.siteUrl);

  try {
    const action = await describePayAction(url, {
      guardian: serverGuardian(),
      connection: serverConnection(),
      cluster: publicEnv.cluster,
    });
    return (
      <main>
        <h1>{action.title}</h1>
        <p>{action.description}</p>
        {action.error ? <p role="alert">{action.error.message}</p> : null}
        {action.disabled ? null : <a href={`/app?${query.toString()}`}>{action.label}</a>}
      </main>
    );
  } catch (failure) {
    if (!(failure instanceof ActionFailure)) throw failure;
    return (
      <main>
        <h1>Payment link</h1>
        <p role="alert">{failure.message}</p>
      </main>
    );
  }
}
