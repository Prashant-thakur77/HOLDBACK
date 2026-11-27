/**
 * The browser's Supabase client. It carries only the anon key; row-level
 * security decides what it can read. Without a wallet session it sees the
 * public counters and receipts. With one (a JWT from the agent holding the
 * `wallet` claim) it can also read and subscribe to that wallet's holds.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { publicEnv } from '../env';

let client: SupabaseClient | null | undefined;
let sessionToken: string | null = null;

/** The shared client, or `null` when Supabase is not configured. */
export function browserSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const { supabaseUrl, supabaseAnonKey } = publicEnv;
  if (!supabaseUrl || !supabaseAnonKey) {
    client = null;
    return client;
  }
  client = createClient(supabaseUrl, supabaseAnonKey, {
    // Sessions come from the agent, not Supabase Auth. Returning `null`
    // makes the client fall back to the anon key.
    accessToken: async () => sessionToken,
  });
  return client;
}

/**
 * Sets or clears the wallet-session JWT used for REST and Realtime. Open
 * Realtime channels are re-authorised in place.
 */
export async function setSupabaseSession(token: string | null): Promise<void> {
  sessionToken = token;
  await browserSupabase()?.realtime.setAuth();
}
