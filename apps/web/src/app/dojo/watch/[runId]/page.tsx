import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { loadDojoWatch } from '@/lib/dojo/watch.server';

import { WatchRun } from './WatchRun';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Scam Dojo run' };

interface Props {
  params: Promise<{ runId: string }>;
}

// Structure only, visual design pending. Data: `loadDojoWatch(runId)` on the
// server, `useDojoWatch(runId, initial)` in the client component.
//
// This route is embedded by app.bytearena.fun; its framing header is set in
// next.config.ts (see src/lib/security-headers.ts).
export default async function DojoWatchPage({ params }: Props) {
  const { runId } = await params;
  const run = await loadDojoWatch(runId);
  if (!run) notFound();
  return (
    <main>
      <h1>Scam Dojo</h1>
      <WatchRun runId={runId} initial={run} />
    </main>
  );
}
