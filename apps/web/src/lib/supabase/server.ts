import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { publicEnv } from '../env';
import { serverEnv } from '../env.server';

/**
 * Service-role client: bypasses row-level security, so it exists only on the
 * server and only for code that must write (the Dojo run store). Returns
 * `null` when the URL or the key is missing.
 *
 * A new client per call keeps nothing between requests, which is what a
 * Worker isolate expects; the client is a thin fetch wrapper, so this is cheap.
 */
export function serviceSupabase(): SupabaseClient | null {
  const key = serverEnv().supabaseServiceRoleKey;
  if (!publicEnv.supabaseUrl || !key) return null;
  return createClient(publicEnv.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Anonymous client for public server-side reads (`live_stats`). It has the
 * same rights as a browser without a session.
 */
export function anonSupabase(): SupabaseClient | null {
  const { supabaseUrl, supabaseAnonKey } = publicEnv;
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
