'use client';

import {
  BaseSignerWalletAdapter,
  type WalletName,
  WalletNotConnectedError,
  WalletReadyState,
  type TransactionOrVersionedTransaction,
} from '@solana/wallet-adapter-base';
import { Keypair, Transaction, type PublicKey } from '@solana/web3.js';

/** Where the throwaway key lives: this browser only. It holds devnet SOL and nothing else. */
const STORAGE_KEY = 'holdback.try.keypair';

export const THROWAWAY_WALLET = 'Throwaway devnet wallet' as WalletName<'Throwaway devnet wallet'>;

/** A small receipt-slip drawing, so the wallet has an icon like any other. */
const ICON =
  'data:image/svg+xml;base64,' +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="4" y="3" width="24" height="26" rx="2" fill="#f2ead8" stroke="#1d1a16" stroke-width="2"/><path d="M9 11h14M9 16h10M9 21h7" stroke="#1d1a16" stroke-width="2"/></svg>',
  );

function readStored(): Keypair | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const bytes = JSON.parse(raw) as number[];
    return bytes.length === 64 ? Keypair.fromSecretKey(Uint8Array.from(bytes)) : null;
  } catch {
    return null;
  }
}

/** The key for this browser, made on first use and kept across reloads. */
export function throwawayKeypair(): Keypair {
  const stored = readStored();
  if (stored) return stored;
  const fresh = Keypair.generate();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(fresh.secretKey)));
  } catch {
    // Private mode: the key lasts as long as the tab.
  }
  return fresh;
}

/** Drops the stored key; the next connect makes a new one. */
export function forgetThrowawayKeypair(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored.
  }
}

/**
 * A wallet adapter backed by a key made in the browser, for the Try it page.
 * It lets the page use the same hooks as the real app (`useSendProtected`,
 * `useHoldActions`) without asking a visitor to install anything. Signing is
 * silent, so it is only ever offered on devnet, on that one page.
 */
export class ThrowawayWalletAdapter extends BaseSignerWalletAdapter {
  name = THROWAWAY_WALLET;
  url = 'https://holdback.prashantthakur.dev/try';
  icon = ICON;
  supportedTransactionVersions = new Set(['legacy', 0] as const);

  private keypair: Keypair | null = null;

  get connecting(): boolean {
    return false;
  }

  get publicKey(): PublicKey | null {
    return this.keypair?.publicKey ?? null;
  }

  get readyState(): WalletReadyState {
    return typeof window === 'undefined' ? WalletReadyState.Unsupported : WalletReadyState.Loadable;
  }

  async connect(): Promise<void> {
    // Like a real wallet, answer on a later tick: the provider subscribes to
    // 'connect' in an effect that may run after this call starts.
    await new Promise((resolve) => setTimeout(resolve, 0));
    this.keypair = throwawayKeypair();
    this.emit('connect', this.keypair.publicKey);
  }

  async disconnect(): Promise<void> {
    this.keypair = null;
    this.emit('disconnect');
  }

  async signTransaction<
    T extends TransactionOrVersionedTransaction<this['supportedTransactionVersions']>,
  >(transaction: T): Promise<T> {
    const keypair = this.keypair;
    if (!keypair) throw new WalletNotConnectedError();
    if (transaction instanceof Transaction) transaction.partialSign(keypair);
    else transaction.sign([keypair]);
    return transaction;
  }
}
