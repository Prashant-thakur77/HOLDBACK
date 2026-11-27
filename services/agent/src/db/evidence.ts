/**
 * Evidence documents by hash. With Supabase they are durable; without it
 * (local development) the documents of this isolate are kept in memory so
 * a receipt can still be verified right after an assessment.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EvidenceDocument, Lang } from '@holdback/sdk';

export interface StoredEvidence {
  document: EvidenceDocument;
  spoken: Partial<Record<Lang, string>>;
}

const MAX_LOCAL = 200;
const local = new Map<string, StoredEvidence>();

export async function putEvidence(
  db: SupabaseClient | null,
  hash: string,
  stored: StoredEvidence,
): Promise<void> {
  if (local.size >= MAX_LOCAL) {
    const oldest = local.keys().next().value;
    if (oldest !== undefined) local.delete(oldest);
  }
  local.set(hash, stored);
  if (!db) return;
  const { error } = await db
    .from('evidence')
    .upsert({ hash, document: stored.document, spoken: stored.spoken });
  if (error) throw new Error('could not store the evidence document');
}

export async function getEvidence(
  db: SupabaseClient | null,
  hash: string,
): Promise<StoredEvidence | null> {
  if (db) {
    const { data, error } = await db
      .from('evidence')
      .select('document, spoken')
      .eq('hash', hash)
      .maybeSingle();
    if (!error && data) {
      return {
        document: data.document as EvidenceDocument,
        spoken: (data.spoken ?? {}) as StoredEvidence['spoken'],
      };
    }
  }
  return local.get(hash) ?? null;
}
