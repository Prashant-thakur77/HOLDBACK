'use client';

import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { useMemo, type ReactNode } from 'react';

import { rpcUrl } from '@/lib/cluster';
import { DEFAULT_COMMITMENT } from '@/lib/solana';
import { ThrowawayWalletAdapter } from '@/lib/try/throwaway';

/**
 * The Try it page signs with a throwaway key made in the browser, through
 * the same wallet context the app uses. Its own storage key keeps it from
 * selecting the throwaway wallet on /app.
 */
export default function TryLayout({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [new ThrowawayWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={rpcUrl()} config={{ commitment: DEFAULT_COMMITMENT }}>
      <WalletProvider wallets={wallets} autoConnect localStorageKey="holdback.try.wallet">
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
