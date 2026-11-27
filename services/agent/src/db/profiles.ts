import type { SupabaseClient } from '@supabase/supabase-js';
import type { Lang } from '@holdback/sdk';

export interface Profile {
  wallet: string;
  lang: Lang;
  push_token: string | null;
  phone: string | null;
  phone_verified: boolean;
}

const COLUMNS = 'wallet, lang, push_token, phone, phone_verified';

export async function getProfile(db: SupabaseClient, wallet: string): Promise<Profile | null> {
  const { data, error } = await db
    .from('profiles')
    .select(COLUMNS)
    .eq('wallet', wallet)
    .maybeSingle();
  if (error) throw new Error('profile lookup failed');
  return (data as Profile | null) ?? null;
}

export async function savePushToken(
  db: SupabaseClient,
  wallet: string,
  pushToken: string,
  lang: Lang,
): Promise<void> {
  const { error } = await db.from('profiles').upsert({ wallet, push_token: pushToken, lang });
  if (error) throw new Error('could not save the push token');
}
