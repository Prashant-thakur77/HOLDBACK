/**
 * Two-level TTL cache for collector answers: a per-isolate map in front of
 * the Supabase `evidence_cache` table. Evidence sources are slow, metered
 * or both, so every collector goes through here.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

interface Entry {
  value: unknown;
  expiresAt: number;
}

const MAX_MEMORY_ENTRIES = 1_000;
const memory = new Map<string, Entry>();

function remember(key: string, entry: Entry): void {
  if (memory.size >= MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  memory.set(key, entry);
}

/** Tests start from an empty isolate. */
export function clearMemoryCache(): void {
  memory.clear();
}

export class EvidenceCache {
  constructor(private readonly db: SupabaseClient | null) {}

  async get<T>(source: string, subject: string): Promise<T | undefined> {
    const key = `${source}:${subject}`;
    const now = Date.now();
    const local = memory.get(key);
    if (local && local.expiresAt > now) return local.value as T;
    if (!this.db) return undefined;
    try {
      const { data } = await this.db
        .from('evidence_cache')
        .select('json, expires_at')
        .eq('key', key)
        .maybeSingle();
      if (!data) return undefined;
      const expiresAt = Date.parse(data.expires_at as string);
      if (expiresAt <= now) return undefined;
      remember(key, { value: data.json, expiresAt });
      return data.json as T;
    } catch {
      return undefined;
    }
  }

  async set(source: string, subject: string, value: unknown, ttlSecs: number): Promise<void> {
    const key = `${source}:${subject}`;
    const expiresAt = Date.now() + ttlSecs * 1000;
    remember(key, { value, expiresAt });
    if (!this.db) return;
    try {
      await this.db
        .from('evidence_cache')
        .upsert({ key, source, json: value, expires_at: new Date(expiresAt).toISOString() });
    } catch {
      // The memory copy still serves this isolate.
    }
  }

  /** Returns the cached value or loads, stores and returns a fresh one. Failures are not cached. */
  async wrap<T>(
    source: string,
    subject: string,
    ttlSecs: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.get<T>(source, subject);
    if (cached !== undefined) return cached;
    const fresh = await load();
    await this.set(source, subject, fresh, ttlSecs);
    return fresh;
  }

  /**
   * True the first time it is called for `key` within `ttlSecs`, false
   * afterwards, across isolates when Supabase is configured. Used so a push
   * or a call is sent once.
   */
  async claimOnce(key: string, ttlSecs: number): Promise<boolean> {
    const full = `once:${key}`;
    const now = Date.now();
    const local = memory.get(full);
    if (local && local.expiresAt > now) return false;
    remember(full, { value: true, expiresAt: now + ttlSecs * 1000 });
    if (!this.db) return true;
    const row = {
      key: full,
      source: 'once',
      json: {},
      expires_at: new Date(now + ttlSecs * 1000).toISOString(),
    };
    const { error } = await this.db.from('evidence_cache').insert(row);
    if (!error) return true;
    // A primary-key conflict: either another isolate claimed it, or an old
    // claim expired and may be taken over.
    const { data } = await this.db
      .from('evidence_cache')
      .update(row)
      .eq('key', full)
      .lt('expires_at', new Date(now).toISOString())
      .select('key');
    return (data?.length ?? 0) > 0;
  }
}
