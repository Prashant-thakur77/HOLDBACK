'use client';

import type { HoldRecord } from '@holdback/sdk';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { errorMessage } from '@/lib/errors';
import { createGuardian } from '@/lib/guardian';
import { upsertRecord } from '@/lib/holds';
import { getSession, subscribeSessions } from '@/lib/session-store';
import { browserSupabase } from '@/lib/supabase/browser';
import { subscribeToHolds, type HoldsRole } from '@/lib/supabase/realtime';

/** How often the list is refetched when Realtime is not available. */
const POLL_MS = 10_000;

export interface HoldsState {
  holds: HoldRecord[];
  /** `unavailable`: no agent is configured, so there is nothing to list from. */
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
  /** How changes arrive right now. */
  mode: 'realtime' | 'polling';
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * A wallet's holds as sender or recipient, newest first.
 *
 * The list always comes from the agent (`GuardianClient.holds`). How it stays
 * fresh depends on the wallet session (see `useWalletSession`):
 *
 * - with a session JWT and Supabase configured, Realtime pushes each change
 *   to the `holds` mirror and the list is patched in place;
 * - otherwise, or when the channel fails, the list is refetched every ten
 *   seconds while the tab is visible.
 */
export function useHolds(wallet: string | null, role: HoldsRole = 'sender'): HoldsState {
  const session = useSyncExternalStore(
    subscribeSessions,
    () => getSession(wallet),
    () => null,
  );
  const token = session?.token ?? null;
  const guardian = useMemo(() => createGuardian({ token: token ?? undefined }), [token]);

  const [holds, setHolds] = useState<HoldRecord[]>([]);
  const [status, setStatus] = useState<HoldsState['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  /** Guards against a slow response for a previous wallet or role overwriting the current one. */
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (!wallet) return;
    if (!guardian) {
      setStatus('unavailable');
      return;
    }
    const current = generation.current;
    try {
      const result = await guardian.holds(wallet, role);
      if (current !== generation.current) return;
      setHolds(result.holds);
      setError(null);
      setStatus('ready');
    } catch (failure) {
      if (current !== generation.current) return;
      setError(errorMessage(failure));
      setStatus('error');
    }
  }, [guardian, wallet, role]);

  // The effects below call the latest `refresh` without re-running when only
  // the session token (and with it the client) changed.
  const latestRefresh = useRef(refresh);
  useEffect(() => {
    latestRefresh.current = refresh;
  }, [refresh]);

  // First load, and a clean slate whenever the wallet or the role changes.
  useEffect(() => {
    generation.current += 1;
    setHolds([]);
    setError(null);
    setStatus(wallet ? 'loading' : 'idle');
    void latestRefresh.current();
  }, [wallet, role]);

  // Realtime, when there is a session to authorise it.
  useEffect(() => {
    const supabase = browserSupabase();
    if (!wallet || !token || !supabase) return;
    const unsubscribe = subscribeToHolds({
      supabase,
      wallet,
      role,
      token,
      onRecord: (record) => setHolds((list) => upsertRecord(list, record)),
      onStale: () => void latestRefresh.current(),
      onStatus: (channel) => {
        setLive(channel === 'live');
        // Changes made while the channel was joining are picked up here.
        if (channel === 'live') void latestRefresh.current();
      },
    });
    return () => {
      unsubscribe();
      setLive(false);
    };
  }, [wallet, role, token]);

  // Polling, whenever Realtime is not delivering.
  useEffect(() => {
    if (!wallet || live) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void latestRefresh.current();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [wallet, live]);

  return { holds, status, mode: live ? 'realtime' : 'polling', error, refresh };
}
