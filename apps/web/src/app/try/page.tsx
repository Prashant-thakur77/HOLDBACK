import type { Metadata } from 'next';

import { PageOpener } from '@/components/site/blocks';

import { TryFlow } from './TryFlow';

export const metadata: Metadata = {
  title: 'Try it',
  description:
    'Get a throwaway devnet wallet, receive a scam message, read the risk verdict, pay into a hold and take it back. Every step is a real Solana devnet transaction.',
};

/** The product end to end, with no wallet to install. */
export default function TryPage() {
  return (
    <main>
      <PageOpener
        word="Try it"
        ink="green"
        page={9}
        motif="tickets"
        lead="Fall for a scam on purpose, then take the money back. Four steps, about a minute, every one a real transaction on Solana devnet."
      />
      <div className="wrap section--tight">
        <TryFlow />
      </div>
    </main>
  );
}
