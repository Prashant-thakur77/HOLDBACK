/**
 * Mounts the Scam Dojo engine's HTTP handler for this deployment: where runs
 * are stored, how the game's `check_address` move reaches the real risk
 * agent, and how the end-of-run Memo gets written.
 */
import 'server-only';

import {
  createDojoHandler,
  memoryStore,
  supabaseStore,
  type DojoAssess,
  type DojoStore,
} from '@holdback/dojo';
import type { SupabaseClient } from '@supabase/supabase-js';

import { serverEnv, type ServerEnv } from '../env.server';
import { IntegrationUnavailableError } from '../errors';
import { serverGuardian } from '../guardian.server';
import { serviceSupabase } from '../supabase/server';
import { writeDojoMemo } from './memo';

export const DOJO_API_PATH = '/api/dojo';

export interface DojoBackend {
  store: DojoStore;
  secret: string;
  /** True when runs are stored in Supabase and survive restarts. */
  persistent: boolean;
}

// One per server process (per isolate on Workers), created on first use.
let processStore: DojoStore | undefined;
let processSecret: string | undefined;
let warned = false;

/**
 * Chooses the run store.
 *
 * Runs are stored in Supabase when the service-role client and `DOJO_SECRET`
 * are both present. The secret matters as much as the database: each run's
 * seed and play token are derived from it, so a run can only be continued by
 * a process that knows the same secret.
 *
 * Otherwise runs are kept in this process's memory, with a secret that lives
 * as long as the process when none is configured. That is fine for local play
 * and tests; on Workers it means a run can vanish between requests, so the
 * fallback is logged loudly, once.
 */
export function dojoBackend(
  env: Pick<ServerEnv, 'dojoSecret'> = serverEnv(),
  supabase: SupabaseClient | null = serviceSupabase(),
): DojoBackend {
  if (supabase && env.dojoSecret) {
    return { store: supabaseStore(supabase), secret: env.dojoSecret, persistent: true };
  }
  if (!warned) {
    warned = true;
    const missing = [
      supabase ? null : 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      env.dojoSecret ? null : 'DOJO_SECRET',
    ].filter(Boolean);
    console.warn(
      `[dojo] ${missing.join(' and ')} not set: Scam Dojo runs are kept in memory only ` +
        'and are lost when this process ends. Do not run production like this.',
    );
  }
  processStore ??= memoryStore();
  processSecret ??= crypto.randomUUID() + crypto.randomUUID();
  return { store: processStore, secret: env.dojoSecret ?? processSecret, persistent: false };
}

/** The game's `check_address` move: a real assessment from the risk agent. */
const assess: DojoAssess = (request) => {
  const guardian = serverGuardian();
  if (!guardian) {
    // The handler turns any failure into "address check unavailable" for the player.
    throw new IntegrationUnavailableError('agent', 'The risk agent is not configured');
  }
  return guardian.assess(request);
};

/** The Dojo's request handler, mounted at `<origin>/api/dojo`. */
export function dojoHandler(origin: string): (request: Request) => Promise<Response> {
  const { store, secret } = dojoBackend();
  return createDojoHandler({
    store,
    secret,
    assess,
    writeMemo: writeDojoMemo,
    baseUrl: `${origin}${DOJO_API_PATH}`,
  });
}
