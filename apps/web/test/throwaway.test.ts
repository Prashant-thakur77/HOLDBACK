import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ThrowawayWalletAdapter,
  forgetThrowawayKeypair,
  throwawayKeypair,
} from '@/lib/try/throwaway';

/** A Map-backed localStorage, enough for the adapter. */
function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  return store;
}

describe('throwaway wallet', () => {
  beforeEach(() => {
    stubStorage();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps one key per browser until it is forgotten', () => {
    const first = throwawayKeypair();
    expect(throwawayKeypair().publicKey.equals(first.publicKey)).toBe(true);
    forgetThrowawayKeypair();
    expect(throwawayKeypair().publicKey.equals(first.publicKey)).toBe(false);
  });

  it('announces its key on connect and signs transactions with it', async () => {
    const adapter = new ThrowawayWalletAdapter();
    const announced = new Promise<PublicKey>((resolve) => adapter.once('connect', resolve));
    await adapter.connect();
    const key = await announced;
    expect(adapter.publicKey?.equals(key)).toBe(true);

    const transaction = new Transaction({
      feePayer: key,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
    }).add(SystemProgram.transfer({ fromPubkey: key, toPubkey: key, lamports: 1 }));
    const signed = await adapter.signTransaction(transaction);
    expect(signed.verifySignatures()).toBe(true);
  });

  it('refuses to sign once disconnected', async () => {
    const adapter = new ThrowawayWalletAdapter();
    await adapter.connect();
    await adapter.disconnect();
    expect(adapter.publicKey).toBeNull();
    await expect(adapter.signTransaction(new Transaction())).rejects.toThrow();
  });
});
