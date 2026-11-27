/**
 * Everything a request or a cron run needs, built once from the
 * environment: database, cache, RPC connections and background scheduling.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fetchConfig, Tier, WINDOW_SECS_BY_TIER } from '@holdback/sdk';
import type { Connection, PublicKey } from '@solana/web3.js';

import type { Background, Env } from './env';
import { EvidenceCache } from './lib/cache';
import { clusterConnection, mainnetConnection, programId } from './lib/solana';

export interface Services {
  env: Env;
  /** `null` when Supabase is not configured; callers degrade to memory or chain. */
  db: SupabaseClient | null;
  cache: EvidenceCache;
  cluster: Connection;
  mainnet: Connection;
  programId: PublicKey;
  background: Background;
}

/** Runs inline when there is no execution context (tests, scripts). */
const inlineBackground: Background = {
  waitUntil(promise) {
    void promise.catch(() => undefined);
  },
};

export function createServices(env: Env, background: Background = inlineBackground): Services {
  const db =
    env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { fetch: (input, init) => fetch(input, init) },
        })
      : null;
  return {
    env,
    db,
    cache: new EvidenceCache(db),
    cluster: clusterConnection(env),
    mainnet: mainnetConnection(env),
    programId: programId(env),
    background,
  };
}

export interface WindowLimits {
  defaultWindowSecs: number;
  maxWindowSecs: number;
}

const LIMITS_TTL_SECS = 300;

/**
 * The window bounds the program enforces, read from its `Config` account.
 * Falls back to the SDK's policy values when the account cannot be read.
 */
export async function windowLimits(services: Services): Promise<WindowLimits> {
  const fallback: WindowLimits = {
    defaultWindowSecs: WINDOW_SECS_BY_TIER[Tier.UNKNOWN],
    maxWindowSecs: WINDOW_SECS_BY_TIER[Tier.SANCTIONED],
  };
  try {
    return await services.cache.wrap('program_config', 'limits', LIMITS_TTL_SECS, async () => {
      const config = await fetchConfig(services.cluster, { programId: services.programId });
      if (!config) throw new Error('config account not found');
      return {
        defaultWindowSecs: config.defaultWindowSecs,
        maxWindowSecs: config.maxWindowSecs,
      };
    });
  } catch {
    return fallback;
  }
}
