'use client';

import { Suspense } from 'react';

import { HoldsPanel } from '@/components/app/HoldsPanel';
import { SendPanel } from '@/components/app/SendPanel';
import { WalletPanel } from '@/components/app/WalletPanel';
import { T } from '@/components/LangProvider';

/**
 * The dashboard. One job per panel: connect, send with a verdict you can
 * read before signing, and the holds with their clocks. Every piece of data
 * and every action comes from a hook in `src/hooks`.
 */
export default function DashboardPage() {
  return (
    <main className="app wrap">
      <header className="app__head">
        <h1 className="h2">Send, and keep the right to change your mind</h1>
        <p className="app__status">
          <span className="pill" data-ink="ink">
            <T k="status.devnet" />
          </span>
        </p>
      </header>
      <hr className="rule" />
      <div className="app__grid">
        {/* Reads the query string, which is only known in the browser. */}
        <Suspense fallback={<section className="panel send" aria-busy="true" />}>
          <SendPanel />
        </Suspense>
        <WalletPanel />
      </div>
      <HoldsPanel role="sender" />
      <HoldsPanel role="recipient" />
    </main>
  );
}
