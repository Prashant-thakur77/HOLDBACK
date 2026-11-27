'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useCallback, useState, useSyncExternalStore } from 'react';

import { errorMessage } from '@/lib/errors';
import { publicEnv } from '@/lib/env';
import { exchangeAuthSignature, requestAuthChallenge, type WalletSession } from '@/lib/guardian';
import { signatureToBase58 } from '@/lib/holds';
import { getSession, setSession, subscribeSessions } from '@/lib/session-store';

export interface WalletSessionState {
  session: WalletSession | null;
  /**
   * `unsupported`: the agent is not configured or the wallet cannot sign
   * messages; live updates then fall back to polling.
   */
  status: 'none' | 'signing' | 'ready' | 'error' | 'unsupported';
  error: string | null;
  /** Asks the wallet to sign the agent's challenge. Call it from a user gesture. */
  signIn: () => Promise<WalletSession | null>;
  signOut: () => void;
}

/**
 * Wallet sign-in for live updates: the agent issues a challenge
 * (`/v1/auth/challenge`), the wallet signs it with `signMessage`, and the
 * agent returns a short-lived JWT (`/v1/auth/session`). Signing a message
 * costs nothing and moves no funds.
 *
 * Signing is never triggered automatically: a wallet prompt the user did not
 * ask for is exactly what a scam page looks like.
 */
export function useWalletSession(): WalletSessionState {
  const { publicKey, signMessage } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const session = useSyncExternalStore(
    subscribeSessions,
    () => getSession(wallet),
    () => null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agentUrl = publicEnv.agentUrl;
  const supported = Boolean(agentUrl && wallet && signMessage);

  const signIn = useCallback(async () => {
    if (!agentUrl || !wallet || !signMessage) return null;
    setBusy(true);
    setError(null);
    try {
      const challenge = await requestAuthChallenge(agentUrl, wallet);
      const signature = await signMessage(new TextEncoder().encode(challenge.message));
      const next = await exchangeAuthSignature(
        agentUrl,
        challenge,
        wallet,
        signatureToBase58(signature),
      );
      setSession(wallet, next);
      return next;
    } catch (failure) {
      setError(errorMessage(failure));
      return null;
    } finally {
      setBusy(false);
    }
  }, [agentUrl, wallet, signMessage]);

  const signOut = useCallback(() => {
    if (wallet) setSession(wallet, null);
  }, [wallet]);

  const status = !supported
    ? 'unsupported'
    : busy
      ? 'signing'
      : session
        ? 'ready'
        : error
          ? 'error'
          : 'none';

  return { session, status, error, signIn, signOut };
}
