import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { loadDojoWatch } from '@/lib/dojo/watch.server';

import { WatchRun } from './WatchRun';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Scam Dojo run' };

interface Props {
  params: Promise<{ runId: string }>;
}

/**
 * The spectator page. Data: `loadDojoWatch(runId)` on the server,
 * `useDojoWatch(runId, initial)` in the client component.
 *
 * This route is embedded by app.bytearena.fun; its framing header is set in
 * next.config.ts (see src/lib/security-headers.ts), and the site shell leaves
 * it bare (see `isBareRoute`).
 */
export default async function DojoWatchPage({ params }: Props) {
  const { runId } = await params;
  const run = await loadDojoWatch(runId);
  if (!run) notFound();
  return (
    <main className="watch-page">
      <WatchRun runId={runId} initial={run} />
    </main>
  );
}
