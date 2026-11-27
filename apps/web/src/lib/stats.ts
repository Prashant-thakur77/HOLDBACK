/**
 * The public counters. The agent's `/v1/stats` is the primary source; the
 * Supabase `live_stats` view holds the same sums and answers when the agent
 * does not. When neither answers the result is `null`: the page shows the
 * counters as unavailable rather than as zero.
 */
import type { GuardianClient, LiveStats } from '@holdback/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

/** `numeric` and `bigint` columns arrive as numbers or strings; both become numbers here. */
const count = z.coerce.number().finite().nonnegative();

const liveStatsRow = z.object({
  holds_created: count,
  holds_reclaimed: count,
  holds_released: count,
  value_protected_usd: count,
  value_reclaimed_usd: count,
  updated_at: z.string(),
});

export interface LiveStatsResult {
  stats: LiveStats;
  source: 'agent' | 'supabase';
}

async function fromSupabase(supabase: SupabaseClient): Promise<LiveStats | null> {
  const { data, error } = await supabase.from('live_stats').select('*').maybeSingle();
  if (error || !data) return null;
  const row = liveStatsRow.safeParse(data);
  if (!row.success) return null;
  return {
    holdsCreated: row.data.holds_created,
    holdsReclaimed: row.data.holds_reclaimed,
    holdsReleased: row.data.holds_released,
    valueProtectedUsd: row.data.value_protected_usd,
    valueReclaimedUsd: row.data.value_reclaimed_usd,
    updatedAt: row.data.updated_at,
  };
}

export async function fetchLiveStats(sources: {
  guardian: GuardianClient | null;
  supabase: SupabaseClient | null;
}): Promise<LiveStatsResult | null> {
  if (sources.guardian) {
    try {
      return { stats: await sources.guardian.stats(), source: 'agent' };
    } catch {
      // fall through to the view
    }
  }
  if (sources.supabase) {
    try {
      const stats = await fromSupabase(sources.supabase);
      if (stats) return { stats, source: 'supabase' };
    } catch {
      // neither source answered
    }
  }
  return null;
}
