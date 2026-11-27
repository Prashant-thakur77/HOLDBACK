/** Chooses the stores for this process: Supabase when configured, memory otherwise. */
import type { SupabaseClient } from '@supabase/supabase-js';

import { MemoryBlocklists, MemoryEvidence } from './memory';
import { supabaseBlocklists, supabaseEvidence } from './supabase';
import type { Storage } from './types';

export const MEMORY_STORAGE_NOTICE =
  'storage: IN-MEMORY, NOT PERSISTENT. Supabase is not configured, so evidence documents, ' +
  'cached answers and the blocklists live in this process only and are lost on restart. ' +
  'The sender-history collector stays unavailable. Set SUPABASE_URL and ' +
  'SUPABASE_SERVICE_ROLE_KEY for durable storage.';

let memory: Storage | null = null;

/** One set of in-memory stores per process, created (and announced) on first use. */
function memoryStorage(): Storage {
  if (!memory) {
    console.warn(MEMORY_STORAGE_NOTICE);
    memory = {
      info: { kind: 'memory', persistent: false },
      evidence: new MemoryEvidence(),
      blocklists: new MemoryBlocklists(),
    };
  }
  return memory;
}

/** Tests start from an empty process. */
export function resetMemoryStorage(): void {
  memory = null;
}

/**
 * The in-memory stores are a fallback for a missing database and nothing
 * else: with a database configured they are never created, and a database
 * error is an error, not a reason to answer from memory.
 */
export function selectStorage(db: SupabaseClient | null): Storage {
  if (!db) return memoryStorage();
  return {
    info: { kind: 'supabase', persistent: true },
    evidence: supabaseEvidence(db),
    blocklists: supabaseBlocklists(db),
  };
}

export type { BlocklistStore, EvidenceStore, Storage, StorageInfo, StoredEvidence } from './types';
