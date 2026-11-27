import type { SupabaseClient } from '@supabase/supabase-js';

export interface Challenge {
  id: string;
  owner: string;
  mint: string;
  amount: string;
  secret_hash: string;
  created_at: string;
  expires_at: string;
  completed_at: string | null;
  signature: string | null;
}

const COLUMNS =
  'id, owner, mint, amount::text, secret_hash, created_at, expires_at, completed_at, signature';

export async function createChallenge(
  db: SupabaseClient,
  challenge: Pick<Challenge, 'owner' | 'mint' | 'amount' | 'secret_hash' | 'expires_at'>,
): Promise<Challenge> {
  const { data, error } = await db
    .from('relay_challenges')
    .insert(challenge)
    .select(COLUMNS)
    .single();
  if (error || !data) throw new Error('could not create the challenge');
  return data as unknown as Challenge;
}

export async function getChallenge(db: SupabaseClient, id: string): Promise<Challenge | null> {
  const { data, error } = await db
    .from('relay_challenges')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('challenge lookup failed');
  return (data as unknown as Challenge | null) ?? null;
}

/**
 * Marks a challenge completed with the proving transaction. Returns false
 * when it was already completed, or when the same transaction already
 * proved another challenge (`signature` is unique): a proof works once.
 */
export async function completeChallenge(
  db: SupabaseClient,
  id: string,
  signature: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('relay_challenges')
    .update({ completed_at: new Date().toISOString(), signature })
    .eq('id', id)
    .is('completed_at', null)
    .select('id');
  return !error && (data?.length ?? 0) === 1;
}
