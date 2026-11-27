/**
 * A wallet session is a short-lived token the agent issues after the wallet
 * signs a challenge message. It carries the wallet address as a claim that
 * Supabase accepts, which is what lets Realtime deliver this wallet's holds
 * (and only this wallet's) under row-level security.
 */
import { encodeBase58, type WalletSession } from '@holdback/sdk';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { guardian } from '@/data/guardian';

const KEY = 'holdback.wallet.session';

interface SessionStore {
  session: WalletSession | null;
  set(session: WalletSession | null): void;
}

export const useWalletSession = create<SessionStore>((set) => ({
  session: null,
  set: (session) => set({ session }),
}));

const isLive = (session: WalletSession) => Date.parse(session.expiresAt) > Date.now() + 60_000;

/** Restores a stored session for `wallet` if it is still valid. */
export async function restoreWalletSession(wallet: string): Promise<WalletSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const stored = raw ? (JSON.parse(raw) as WalletSession) : null;
    if (stored && stored.wallet === wallet && isLive(stored)) {
      guardian.token = stored.token;
      useWalletSession.getState().set(stored);
      return stored;
    }
  } catch {
    // an unreadable stored session is the same as none
  }
  return null;
}

/**
 * Asks the agent for a challenge, has the wallet sign it and exchanges the
 * signature for a session. Rejects with `WalletActionError` when the user
 * declines in the wallet, or `GuardianError` when the agent refuses.
 */
export async function createWalletSession(
  wallet: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
): Promise<WalletSession> {
  const challenge = await guardian.authChallenge(wallet);
  const signature = await signMessage(new TextEncoder().encode(challenge.message));
  const session = await guardian.authSession({
    wallet,
    challenge: challenge.challenge,
    signature: encodeBase58(signature),
  });
  guardian.token = session.token;
  useWalletSession.getState().set(session);
  await SecureStore.setItemAsync(KEY, JSON.stringify(session)).catch(() => undefined);
  return session;
}

export async function clearWalletSession(): Promise<void> {
  useWalletSession.getState().set(null);
  await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
}
