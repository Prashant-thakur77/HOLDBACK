/**
 * Where the service keeps what it must read back: evidence documents and
 * the static lists. There are two implementations behind these interfaces.
 * Supabase is the real one. The in-memory one exists only so the service
 * can run with no database (local development, evaluation runs); it lives
 * in one process, is lost on restart, and says so wherever it is used.
 */
import type { EvidenceDocument, Lang } from '@holdback/sdk';

import type { RefreshResult } from '../collectors/blocklist-refresh';

export type StorageKind = 'supabase' | 'memory';

/** Reported with every assessment so a caller can tell what kind of run it is talking to. */
export interface StorageInfo {
  kind: StorageKind;
  /** False for the in-memory store: nothing survives a restart or reaches another instance. */
  persistent: boolean;
}

export interface StoredEvidence {
  document: EvidenceDocument;
  spoken: Partial<Record<Lang, string>>;
}

export interface EvidenceStore {
  put(hash: string, stored: StoredEvidence): Promise<void>;
  get(hash: string): Promise<StoredEvidence | null>;
}

export interface ListHit {
  list: string;
  value: string;
}

export interface ListMeta {
  list: string;
  entries: number;
  refreshedAt: string;
  sourceUrl: string;
}

export type ListKind = 'address' | 'domain';

/** The write half, which is all a list refresh needs. */
export interface BlocklistWriter {
  /** Makes the stored addresses of `list` equal to `values`. */
  replaceAddresses(list: string, values: string[]): Promise<void>;
  /** Replaces all hashed shards of one domain list. */
  saveDomainShards(list: string, shards: string[]): Promise<void>;
  saveMeta(list: string, entries: number, sourceUrl: string): Promise<void>;
}

export interface BlocklistStore extends BlocklistWriter {
  /**
   * Makes lists of `kind` ready to query. A database is filled by the
   * scheduled refresh, so this does nothing there; the in-memory store
   * downloads the lists the first time they are needed.
   */
  prepare(kind: ListKind): Promise<void>;
  /** Which of `values` are listed addresses, and on which list. */
  lookupAddresses(values: string[]): Promise<ListHit[]>;
  /** Packed shards by `shardKey`; missing shards are absent. */
  loadDomainShards(wanted: { list: string; shard: number }[]): Promise<Map<string, string>>;
  listMeta(): Promise<ListMeta[]>;
  /** Downloads the lists again. One list failing leaves its previous copy in place. */
  refresh(): Promise<RefreshResult[]>;
}

export interface Storage {
  info: StorageInfo;
  evidence: EvidenceStore;
  blocklists: BlocklistStore;
}

/** Key of one shard of one domain list, in either store. */
export const shardKey = (list: string, shard: number) => `blocklist_domains:${list}:${shard}`;
