/**
 * Collector 3: static lists. The recipient address is matched exactly
 * against the address lists; domains the sender mentioned are matched
 * (exactly or by parent suffix) against the phishing lists.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { listMeta, loadDomainShards, lookupAddresses, shardKey } from '../db/blocklist';
import { CollectorUnavailable } from '../errors';
import type { EvidenceCache } from '../lib/cache';
import type { Signal } from '../signals';
import {
  domainCandidates,
  extractDomains,
  hashDomain,
  normaliseAddress,
  packedHas,
  shardOf,
  unpackShard,
} from './blocklist-parse';
import { DOMAIN_LISTS, metaName } from './blocklist-refresh';
import type { Collector } from './types';

const ADDRESS_TTL_SECS = 10 * 60;
const META_TTL_SECS = 10 * 60;
/** Domains checked per note; a note with more is not a payment reason. */
const MAX_CONTEXT_DOMAINS = 5;

export const LIST_URLS: Record<string, string> = {
  ofac: 'https://sanctionssearch.ofac.treas.gov/',
  scamsniffer: 'https://github.com/scamsniffer/scam-database',
  phantom: 'https://github.com/phantom/blocklist',
  metamask: 'https://github.com/MetaMask/eth-phishing-detect',
};

/** The first list that contains `domain` or one of its parents, with the matching entry. */
export async function findListedDomain(
  db: SupabaseClient,
  domain: string,
): Promise<{ list: string; matched: string } | null> {
  const candidates = domainCandidates(domain).map((candidate) => ({
    candidate,
    hash: hashDomain(candidate),
  }));
  const wanted = DOMAIN_LISTS.flatMap((list) =>
    candidates.map(({ hash }) => ({ list, shard: shardOf(hash) })),
  );
  const shards = await loadDomainShards(db, wanted);
  for (const list of DOMAIN_LISTS) {
    for (const { candidate, hash } of candidates) {
      const packed = shards.get(shardKey(list, shardOf(hash)));
      if (packed && packedHas(unpackShard(packed), hash)) return { list, matched: candidate };
    }
  }
  return null;
}

async function loadedLists(db: SupabaseClient, cache: EvidenceCache): Promise<Set<string>> {
  const names = await cache.wrap('blocklist_meta', 'loaded', META_TTL_SECS, async () => {
    const meta = await listMeta(db);
    // Do not cache "nothing loaded": the first refresh may finish any minute.
    if (meta.length === 0) throw new CollectorUnavailable('blocklists have not been loaded yet');
    return meta.filter((row) => row.entries > 0).map((row) => row.list);
  });
  return new Set(names);
}

export const blocklistCollector: Collector = {
  name: 'blocklist',
  timeoutMs: 3_000,
  cacheTtlSecs: ADDRESS_TTL_SECS,
  async collect({ services, subject }) {
    const { db, cache } = services;
    if (!db) throw new CollectorUnavailable('Supabase is not configured');
    const source = 'blocklist' as const;

    const loaded = await loadedLists(db, cache);
    // Without the sanctions list a "not listed" answer would be a guess.
    if (!loaded.has(metaName('ofac', 'address'))) {
      throw new CollectorUnavailable('the sanctions list has not been loaded yet');
    }

    const address = normaliseAddress(subject.recipient);
    const hits = await cache.wrap('blocklist', address, ADDRESS_TTL_SECS, async () =>
      (await lookupAddresses(db, [address])).map((hit) => hit.list),
    );

    const signals: Signal[] = [];
    if (hits.includes('ofac')) {
      signals.push({
        source,
        signal: 'ofac_sanctioned',
        detail: 'The address is on the OFAC list of sanctioned digital currency addresses.',
        url: LIST_URLS.ofac,
        matched: subject.recipient,
      });
    }
    for (const list of hits.filter((hit) => hit !== 'ofac')) {
      signals.push({
        source,
        signal: 'scam_list_address',
        detail: `The address is on the ${list} scam address list.`,
        url: LIST_URLS[list],
        matched: subject.recipient,
      });
    }

    const domains = extractDomains(subject.context ?? '').slice(0, MAX_CONTEXT_DOMAINS);
    for (const domain of domains) {
      const listed = await findListedDomain(db, domain).catch(() => null);
      if (listed) {
        signals.push({
          source,
          signal: 'phishing_domain_in_context',
          detail: `The site ${listed.matched} is on the ${listed.list} phishing list.`,
          url: LIST_URLS[listed.list],
          matched: listed.matched,
        });
      }
    }

    if (signals.length === 0) {
      signals.push({
        source,
        signal: 'not_listed',
        detail: 'The address is not on the sanctions list or the scam address lists.',
      });
    }
    return signals;
  },
};
