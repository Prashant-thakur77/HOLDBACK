import 'server-only';

import { serverGuardian } from './guardian.server';
import { fetchLiveStats, type LiveStatsResult } from './stats';
import { anonSupabase } from './supabase/server';

/** Counters for server rendering (the landing page's first paint). */
export function loadLiveStats(): Promise<LiveStatsResult | null> {
  return fetchLiveStats({ guardian: serverGuardian(), supabase: anonSupabase() });
}
