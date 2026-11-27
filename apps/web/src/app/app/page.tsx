'use client';

import { Suspense } from 'react';

import { HoldsPanel } from '@/components/app/HoldsPanel';
import { Motif } from '@/components/art/Motifs';
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
      <ol className="app__steps" aria-label="How a payment goes">
        <li data-ink="blue">
          <Motif name="phone" size={64} />
          <span>
            <b>Connect</b> a wallet on devnet.
          </span>
        </li>
        <li data-ink="blue">
          <Motif name="punch" size={64} />
          <span>
            <b>Read the verdict</b> before you sign: the evidence sets the undo window.
          </span>
        </li>
        <li data-ink="blue">
          <Motif name="tickets" size={64} />
          <span>
            <b>Send.</b> Until the window ends, one press takes it back.
          </span>
        </li>
      </ol>
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
