'use client';

/**
 * Wallet context for every page that signs. No wallet list is passed:
 * wallets that implement the Wallet Standard (Phantom, Solflare, Backpack
 * and the rest) announce themselves and are detected automatically.
 *
 * This component renders no interface. Pages read `useWallet()` for the
 * detected wallets and build their own connect controls.
 */
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import type { ReactNode } from 'react';

import { rpcUrl } from '@/lib/cluster';
import { DEFAULT_COMMITMENT } from '@/lib/solana';

const NO_ADAPTERS: never[] = [];

export function WalletProviders({ children }: { children: ReactNode }) {
  return (
    <ConnectionProvider endpoint={rpcUrl()} config={{ commitment: DEFAULT_COMMITMENT }}>
      <WalletProvider wallets={NO_ADAPTERS} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
