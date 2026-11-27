/**
 * Wallet sessions for the current tab. A session is the JWT the agent issues
 * after a wallet signs its challenge; Supabase accepts it for that wallet's
 * rows. Sessions live in `sessionStorage`, so they end with the tab and are
 * never shared across origins or sent anywhere but Supabase and the agent.
 */
import type { WalletSession } from './guardian';

const KEY_PREFIX = 'holdback.session.';
/** A session this close to expiry is treated as gone, so it cannot lapse mid-request. */
const EXPIRY_MARGIN_MS = 30_000;

const sessions = new Map<string, WalletSession | null>();
const listeners = new Set<() => void>();

function isLive(session: WalletSession): boolean {
  return Date.parse(session.expiresAt) - EXPIRY_MARGIN_MS > Date.now();
}

function readStored(wallet: string): WalletSession | null {
  try {
    const raw = window.sessionStorage.getItem(KEY_PREFIX + wallet);
    if (!raw) return null;
    const session = JSON.parse(raw) as WalletSession;
    return session.wallet === wallet && typeof session.token === 'string' ? session : null;
  } catch {
    // Storage can be blocked; the session then lasts for this page only.
    return null;
  }
}

/** The live session for a wallet, or `null`. Stable between changes, for `useSyncExternalStore`. */
export function getSession(wallet: string | null): WalletSession | null {
  if (!wallet || typeof window === 'undefined') return null;
  if (!sessions.has(wallet)) sessions.set(wallet, readStored(wallet));
  const session = sessions.get(wallet) ?? null;
  if (session && !isLive(session)) {
    sessions.set(wallet, null);
    return null;
  }
  return session;
}

export function setSession(wallet: string, session: WalletSession | null): void {
  sessions.set(wallet, session);
  try {
    if (session) window.sessionStorage.setItem(KEY_PREFIX + wallet, JSON.stringify(session));
    else window.sessionStorage.removeItem(KEY_PREFIX + wallet);
  } catch {
    // See `readStored`.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
