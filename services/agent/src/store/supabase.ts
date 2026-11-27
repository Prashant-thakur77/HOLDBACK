/**
 * The durable stores. Evidence documents are rows in `evidence`. Listed
 * addresses are rows in `blocklist_entries` (exact lookups); domain lists
 * are hashed shards in `evidence_cache` under the `blocklist_domains`
 * source; `blocklist_meta` records when each list was last refreshed.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EvidenceDocument } from '@holdback/sdk';

import { DOMAIN_SHARDS } from '../collectors/blocklist-parse';
import { refreshBlocklists } from '../collectors/blocklist-refresh';
import {
  shardKey,
  type BlocklistStore,
  type EvidenceStore,
  type ListHit,
  type StoredEvidence,
} from './types';

const CHUNK = 500;
/** Shards outlive several missed refreshes, then stop answering. */
const SHARD_TTL_SECS = 7 * 86_400;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function supabaseEvidence(db: SupabaseClient): EvidenceStore {
  return {
    async put(hash, stored) {
      const { error } = await db
        .from('evidence')
        .upsert({ hash, document: stored.document, spoken: stored.spoken });
      if (error) throw new Error('could not store the evidence document');
    },
    async get(hash) {
      const { data, error } = await db
        .from('evidence')
        .select('document, spoken')
        .eq('hash', hash)
        .maybeSingle();
      if (error) throw new Error('evidence lookup failed');
      if (!data) return null;
      return {
        document: data.document as EvidenceDocument,
        spoken: (data.spoken ?? {}) as StoredEvidence['spoken'],
      };
    },
  };
}

export function supabaseBlocklists(db: SupabaseClient): BlocklistStore {
  const store: BlocklistStore = {
    // The scheduled refresh fills the tables; there is nothing to do per request.
    async prepare() {},

    async lookupAddresses(values) {
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
    },

    async listMeta() {
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
    },

    async saveMeta(list, entries, sourceUrl) {
      const { error } = await db.from('blocklist_meta').upsert({
        list,
        entries,
        source_url: sourceUrl,
        refreshed_at: new Date().toISOString(),
      });
      if (error) throw new Error(`could not record refresh of ${list}`);
    },

    async replaceAddresses(list, values) {
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
    },

    async saveDomainShards(list, shards) {
      const expiresAt = new Date(Date.now() + SHARD_TTL_SECS * 1000).toISOString();
      const rows = shards.map((packed, shard) => ({
        key: shardKey(list, shard),
        source: 'blocklist_domains',
        json: { packed },
        expires_at: expiresAt,
      }));
      const { error } = await db.from('evidence_cache').upsert(rows);
      if (error) throw new Error(`could not store ${list} domains`);
    },

    async loadDomainShards(wanted) {
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
    },

    refresh: () => refreshBlocklists(store),
  };
  return store;
}
