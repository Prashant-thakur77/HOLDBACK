/**
 * `helius-webhook`: keeps the off-chain mirror in step with the chain.
 *
 * Helius posts every transaction that touches the HOLDBACK program here. The
 * function authenticates the call with a shared secret, decodes the Anchor
 * events from the transaction logs and hands them to the database function
 * `ingest_hold_events`, which updates `holds`, `instant_transfers` and
 * `metrics_daily` in one transaction and ignores anything it has seen before.
 *
 * All logic lives in `_shared/`; this file only binds it to the Edge runtime.
 */
import { createClient } from '@supabase/supabase-js';

import { PROGRAM_ID } from '../_shared/events.ts';
import { createHandler, type IngestResult } from '../_shared/handler.ts';
import { createLogFetcher } from '../_shared/rpc.ts';
import { parseStablecoins } from '../_shared/stablecoins.ts';

function requireEnv(...names: string[]): string {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value) return value;
  }
  throw new Error(`Missing environment variable: ${names.join(' or ')}`);
}

// The service role bypasses row-level security; it never leaves this function.
const supabase = createClient(
  requireEnv('SUPABASE_URL'),
  requireEnv('SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const rpcUrl = Deno.env.get('HELIUS_RPC_URL');

Deno.serve(
  createHandler({
    secret: Deno.env.get('HELIUS_WEBHOOK_SECRET'),
    programId: Deno.env.get('HOLDBACK_PROGRAM_ID') || PROGRAM_ID,
    stablecoins: parseStablecoins(Deno.env.get('USD_STABLECOIN_MINTS')),
    fetchLogs: rpcUrl ? createLogFetcher(rpcUrl) : undefined,
    ingest: async (events) => {
      const { data, error } = await supabase.rpc('ingest_hold_events', { p_events: events });
      if (error) throw new Error(`ingest_hold_events: ${error.message}`);
      return data as IngestResult[];
    },
  }),
);
