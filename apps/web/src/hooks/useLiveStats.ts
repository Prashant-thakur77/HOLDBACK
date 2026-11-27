'use client';

import { useEffect, useState } from 'react';

import { createGuardian } from '@/lib/guardian';
import { fetchLiveStats, type LiveStatsResult } from '@/lib/stats';
import { browserSupabase } from '@/lib/supabase/browser';

const REFRESH_MS = 30_000;

export interface LiveStatsState {
  /** `null` until loaded, and when neither source answers. */
  result: LiveStatsResult | null;
  status: 'loading' | 'ready' | 'unavailable';
}

/**
 * The public counters, refreshed every 30 seconds: the agent's `/v1/stats`
 * first, the Supabase `live_stats` view when the agent does not answer.
 * Pass the server-loaded value as `initial` to avoid an empty first paint.
 */
export function useLiveStats(initial: LiveStatsResult | null = null): LiveStatsState {
  const [state, setState] = useState<LiveStatsState>({
    result: initial,
    status: initial ? 'ready' : 'loading',
  });

  useEffect(() => {
    let active = true;
    const load = async () => {
      const result = await fetchLiveStats({
        guardian: createGuardian(),
        supabase: browserSupabase(),
      });
      if (!active) return;
      // A failed refresh keeps the last good numbers on screen.
      setState((previous) =>
        result
          ? { result, status: 'ready' }
          : { result: previous.result, status: previous.result ? 'ready' : 'unavailable' },
      );
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return state;
}
