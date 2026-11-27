/**
 * Storage for the static lists. Addresses are rows in `blocklist_entries`
 * (exact lookups). Domain lists are hashed shards in `evidence_cache`
 * under the `blocklist_domains` source. `blocklist_meta` records when each
 * list was last refreshed.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { DOMAIN_SHARDS } from '../collectors/blocklist-parse';

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

const CHUNK = 500;
/** Shards outlive several missed refreshes, then stop answering. */
const SHARD_TTL_SECS = 7 * 86_400;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Which of `values` are listed addresses, and on which list. */
export async function lookupAddresses(db: SupabaseClient, values: string[]): Promise<ListHit[]> {
  const hits: ListHit[] = [];
  for (const part of chunks([...new Set(values)], 200)) {
    const { data, error } = await db
      .from('blocklist_entries')
      .select('list, value')
      .eq('kind', 'address')
      .in('value', part);
    if (error) throw new Error('blocklist lookup failed');
    hits.push(...((data ?? []) as ListHit[]));
  }
  return hits;
}

export async function listMeta(db: SupabaseClient): Promise<ListMeta[]> {
  const { data, error } = await db
    .from('blocklist_meta')
    .select('list, entries, refreshed_at, source_url');
  if (error) throw new Error('blocklist meta lookup failed');
  return (data ?? []).map((row) => ({
    list: row.list as string,
    entries: row.entries as number,
    refreshedAt: row.refreshed_at as string,
    sourceUrl: row.source_url as string,
  }));
}

export async function saveMeta(
  db: SupabaseClient,
  list: string,
  entries: number,
  sourceUrl: string,
): Promise<void> {
  const { error } = await db.from('blocklist_meta').upsert({
    list,
    entries,
    source_url: sourceUrl,
    refreshed_at: new Date().toISOString(),
  });
  if (error) throw new Error(`could not record refresh of ${list}`);
}

/** Makes the stored addresses of `list` equal to `values`: adds new ones, removes dropped ones. */
export async function replaceAddresses(
  db: SupabaseClient,
  list: string,
  values: string[],
): Promise<void> {
  const wanted = new Set(values);
  const existing = new Set<string>();
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await db
      .from('blocklist_entries')
      .select('value')
      .eq('list', list)
      .eq('kind', 'address')
      .range(from, from + 999);
    if (error) throw new Error(`could not read ${list}`);
    for (const row of data ?? []) existing.add(row.value as string);
    if ((data ?? []).length < 1_000) break;
  }
  const added = [...wanted].filter((value) => !existing.has(value));
  const removed = [...existing].filter((value) => !wanted.has(value));
  for (const part of chunks(added, CHUNK)) {
    const rows = part.map((value) => ({ list, kind: 'address', value }));
    const { error } = await db.from('blocklist_entries').upsert(rows);
    if (error) throw new Error(`could not add to ${list}`);
  }
  for (const part of chunks(removed, 100)) {
    const { error } = await db
      .from('blocklist_entries')
      .delete()
      .eq('list', list)
      .eq('kind', 'address')
      .in('value', part);
    if (error) throw new Error(`could not prune ${list}`);
  }
}

/** Cache key of one shard of one domain list. */
export const shardKey = (list: string, shard: number) => `blocklist_domains:${list}:${shard}`;

/** Replaces all shards of one domain list in a single request. */
export async function saveDomainShards(
  db: SupabaseClient,
  list: string,
  shards: string[],
): Promise<void> {
  const expiresAt = new Date(Date.now() + SHARD_TTL_SECS * 1000).toISOString();
  const rows = shards.map((packed, shard) => ({
    key: shardKey(list, shard),
    source: 'blocklist_domains',
    json: { packed },
    expires_at: expiresAt,
  }));
  const { error } = await db.from('evidence_cache').upsert(rows);
  if (error) throw new Error(`could not store ${list} domains`);
}

/** Loads the given shards of the given lists; missing or expired shards are absent. */
export async function loadDomainShards(
  db: SupabaseClient,
  wanted: { list: string; shard: number }[],
): Promise<Map<string, string>> {
  const keys = wanted
    .filter(({ shard }) => shard >= 0 && shard < DOMAIN_SHARDS)
    .map(({ list, shard }) => shardKey(list, shard));
  const { data, error } = await db
    .from('evidence_cache')
    .select('key, json')
    .in('key', keys)
    .gt('expires_at', new Date().toISOString());
  if (error) throw new Error('domain shard lookup failed');
  const found = new Map<string, string>();
  for (const row of data ?? []) {
    const packed = (row.json as { packed?: string }).packed;
    if (typeof packed === 'string') found.set(row.key as string, packed);
  }
  return found;
}
