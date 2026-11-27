import type { BuiltTransaction } from '@holdback/sdk';
import type { Connection, PublicKey } from '@solana/web3.js';
import { createContext, use } from 'react';

import type { PollarFlow, PollarFlowState } from '@/lib/pollarFlow';
import type { WalletKind } from '@/state/settings';

/** What the Pollar side of the app can do. `null` when no Pollar key is configured. */
export interface PollarHandle {
  /** Signed in to Pollar (email or social). */
  signedIn: boolean;
  /** The Pollar-managed Solana wallet, once it exists. */
  address: PublicKey | null;
  openLogin(): void;
  logout(): Promise<void>;
  /** The deposit-box flow and its current state. */
  flow: PollarFlow;
  state: PollarFlowState;
}

export interface WalletApi {
  /** The kind of wallet in use, or `null` before one is connected. */
  kind: WalletKind | null;
  /** The user's wallet address (the Pollar wallet for Pollar users). */
  address: PublicKey | null;
  connection: Connection;
  /** Opens the wallet chooser (Mobile Wallet Adapter) and resolves with the authorized address. */
  connectWallet(): Promise<PublicKey>;
  disconnect(): Promise<void>;
  /**
   * Builds, signs and sends a transaction with the connected wallet, then
   * waits for confirmation. Rejects with `WalletActionError`; a cancellation
   * has `kind: 'cancelled'`. Only for wallet users.
   */
  signAndConfirm(build: (connection: Connection) => Promise<BuiltTransaction>): Promise<string>;
  /** Signs a message with the connected wallet. Only for wallet users. */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  pollar: PollarHandle | null;
}

export const WalletContext = createContext<WalletApi | null>(null);

export function useWallet(): WalletApi {
  const value = use(WalletContext);
  if (!value) throw new Error('useWallet must be used inside <WalletProvider>');
  return value;
}
