import Link from 'next/link';

import { loadLiveStats } from '@/lib/stats.server';

// The counters are read per request; nothing here is cached.
export const dynamic = 'force-dynamic';

// Structure only, visual design pending. Data: `loadLiveStats()` on the
// server; `useLiveStats(initial)` keeps it fresh in a client component.
export default async function HomePage() {
  const live = await loadLiveStats();
  return (
    <main>
      <h1>HOLDBACK</h1>
      <nav>
        <Link href="/app">Open the app</Link>
      </nav>
      <section aria-label="Live counters">
        {live ? (
          <dl>
            <dt>Holds created</dt>
            <dd>{live.stats.holdsCreated}</dd>
            <dt>Holds reclaimed</dt>
            <dd>{live.stats.holdsReclaimed}</dd>
            <dt>Holds released</dt>
            <dd>{live.stats.holdsReleased}</dd>
            <dt>Value protected (USD)</dt>
            <dd>{live.stats.valueProtectedUsd}</dd>
            <dt>Value reclaimed (USD)</dt>
            <dd>{live.stats.valueReclaimedUsd}</dd>
          </dl>
        ) : (
          <p>Live counters are unavailable right now.</p>
        )}
      </section>
    </main>
  );
}
