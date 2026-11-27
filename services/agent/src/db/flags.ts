import type { SupabaseClient } from '@supabase/supabase-js';

export interface NewFlag {
  subject: string;
  reporter: string | null;
  reason: number;
  note: string | null;
}

export async function insertFlag(db: SupabaseClient, flag: NewFlag): Promise<string> {
  const { data, error } = await db.from('flags_offchain').insert(flag).select('id').single();
  if (error || !data) throw new Error('could not store the report');
  return data.id as string;
}

/** Number of reports about `subject`. */
export async function countOffchainFlags(db: SupabaseClient, subject: string): Promise<number> {
  const { count, error } = await db
    .from('flags_offchain')
    .select('id', { count: 'exact', head: true })
    .eq('subject', subject);
  if (error) throw new Error('could not count reports');
  return count ?? 0;
}

export async function markFlagMirrored(
  db: SupabaseClient,
  id: string,
  evidenceHash: string,
  signature: string,
): Promise<void> {
  await db
    .from('flags_offchain')
    .update({ evidence_hash: evidenceHash, onchain_signature: signature })
    .eq('id', id);
}
