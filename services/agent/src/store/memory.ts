/**
 * In-process stores, used only when Supabase is not configured. They make
 * a keyless run useful: assessments can be read back by hash, and the
 * static lists are downloaded from their public sources straight into
 * memory, so a sanctioned address is still recognised.
 *
 * Nothing here persists. It lives in one process (one isolate on Workers),
 * is gone on restart, and is not shared between instances. Sizes are
 * bounded: evidence documents are capped, addresses are kept exactly, and
 * the large domain lists are kept only as hashed shards and only once a
 * note actually mentions a site.
 */
import { refreshBlocklists, type RefreshResult } from '../collectors/blocklist-refresh';
import {
  shardKey,
  type BlocklistStore,
  type EvidenceStore,
  type ListKind,
  type ListMeta,
  type StoredEvidence,
} from './types';

/** Evidence documents kept; the oldest is dropped first. */
export const MAX_EVIDENCE_DOCUMENTS = 500;
/** Lists are downloaded again after this long, the same interval as the scheduled refresh. */
export const REFRESH_INTERVAL_SECS = 3_600;
/** After a failed download the next attempt waits this long, so an outage is not hammered. */
export const RETRY_AFTER_SECS = 60;

export class MemoryEvidence implements EvidenceStore {
  private readonly documents = new Map<string, StoredEvidence>();

  async put(hash: string, stored: StoredEvidence): Promise<void> {
    this.documents.delete(hash);
    if (this.documents.size >= MAX_EVIDENCE_DOCUMENTS) {
      const oldest = this.documents.keys().next().value;
      if (oldest !== undefined) this.documents.delete(oldest);
    }
    this.documents.set(hash, stored);
  }

  async get(hash: string): Promise<StoredEvidence | null> {
    return this.documents.get(hash) ?? null;
  }
}

interface Load {
  /** The download in flight, shared by every caller that needs it. */
  running: Promise<RefreshResult[]> | null;
  /** When the last download started, whether or not it worked. */
  attemptedAt: number;
  /** When a download last brought in at least one list. */
  loadedAt: number;
  /** Whether the last download brought in every list of the kind. */
  complete: boolean;
}

export class MemoryBlocklists implements BlocklistStore {
  private readonly addresses = new Map<string, Set<string>>();
  private readonly shards = new Map<string, string>();
  private readonly meta = new Map<string, ListMeta>();
  private readonly loads: Record<ListKind, Load> = {
    address: { running: null, attemptedAt: 0, loadedAt: 0, complete: false },
    domain: { running: null, attemptedAt: 0, loadedAt: 0, complete: false },
  };

  private download(kind: ListKind): Promise<RefreshResult[]> {
    const load = this.loads[kind];
    if (load.running) return load.running;
    load.attemptedAt = Date.now();
    console.warn(`storage: downloading ${kind} blocklists into memory`);
    load.running = refreshBlocklists(this, kind)
      .then((results) => {
        if (results.some((result) => result.ok)) load.loadedAt = Date.now();
        load.complete = results.every((result) => result.ok);
        for (const result of results) {
          const state = result.ok ? `${result.entries} entries` : `failed (${result.error})`;
          console.warn(`storage: ${result.list} ${result.kind} list in memory: ${state}`);
        }
        return results;
      })
      .finally(() => {
        load.running = null;
      });
    return load.running;
  }

  /**
   * First use downloads and waits. Later, what is in memory is served while
   * a new download runs in the background, when the copy is older than the
   * refresh interval or a list is still missing. After a failure the next
   * attempt waits for a pause.
   */
  async prepare(kind: ListKind): Promise<void> {
    const load = this.loads[kind];
    const now = Date.now();
    if (load.loadedAt === 0) {
      const mayTry = load.running || now - load.attemptedAt >= RETRY_AFTER_SECS * 1000;
      if (mayTry) await this.download(kind);
      return;
    }
    const stale = now - load.loadedAt >= REFRESH_INTERVAL_SECS * 1000;
    const mayRetry = now - load.attemptedAt >= RETRY_AFTER_SECS * 1000;
    if ((stale || !load.complete) && mayRetry) void this.download(kind).catch(() => undefined);
  }

  async lookupAddresses(values: string[]) {
    const hits = [];
    for (const [list, listed] of this.addresses) {
      for (const value of new Set(values)) {
        if (listed.has(value)) hits.push({ list, value });
      }
    }
    return hits;
  }

  async loadDomainShards(wanted: { list: string; shard: number }[]) {
    const found = new Map<string, string>();
    for (const { list, shard } of wanted) {
      const key = shardKey(list, shard);
      const packed = this.shards.get(key);
      if (packed !== undefined) found.set(key, packed);
    }
    return found;
  }

  async listMeta(): Promise<ListMeta[]> {
    return [...this.meta.values()];
  }

  async replaceAddresses(list: string, values: string[]): Promise<void> {
    this.addresses.set(list, new Set(values));
  }

  async saveDomainShards(list: string, shards: string[]): Promise<void> {
    shards.forEach((packed, shard) => this.shards.set(shardKey(list, shard), packed));
  }

  async saveMeta(list: string, entries: number, sourceUrl: string): Promise<void> {
    this.meta.set(list, { list, entries, sourceUrl, refreshedAt: new Date().toISOString() });
  }

  /** The scheduled refresh: addresses always, domain lists only if they were ever needed. */
  async refresh(): Promise<RefreshResult[]> {
    const results = await this.download('address');
    if (this.loads.domain.loadedAt === 0) return results;
    return [...results, ...(await this.download('domain'))];
  }
}
