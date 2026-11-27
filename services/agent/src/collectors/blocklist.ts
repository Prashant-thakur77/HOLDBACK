/**
 * Collector 3: static lists. The recipient address is matched exactly
 * against the address lists; domains the sender mentioned are matched
 * (exactly or by parent suffix) against the phishing lists.
 */
import { CollectorUnavailable } from '../errors';
import type { Signal } from '../signals';
import { shardKey, type BlocklistStore } from '../store/types';
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
  store: BlocklistStore,
  domain: string,
): Promise<{ list: string; matched: string } | null> {
  const candidates = domainCandidates(domain).map((candidate) => ({
    candidate,
    hash: hashDomain(candidate),
  }));
  const wanted = DOMAIN_LISTS.flatMap((list) =>
    candidates.map(({ hash }) => ({ list, shard: shardOf(hash) })),
  );
  const shards = await store.loadDomainShards(wanted);
  for (const list of DOMAIN_LISTS) {
    for (const { candidate, hash } of candidates) {
      const packed = shards.get(shardKey(list, shardOf(hash)));
      if (packed && packedHas(unpackShard(packed), hash)) return { list, matched: candidate };
    }
  }
  return null;
}

/** Names of the lists that hold entries. Throws while nothing has been loaded at all. */
async function loadedLists(store: BlocklistStore): Promise<string[]> {
  const meta = await store.listMeta();
  if (meta.length === 0) throw new CollectorUnavailable('blocklists have not been loaded yet');
  return meta.filter((row) => row.entries > 0).map((row) => row.list);
}

export const blocklistCollector: Collector = {
  name: 'blocklist',
  timeoutMs: 4_000,
  cacheTtlSecs: ADDRESS_TTL_SECS,
  async collect({ services, subject }) {
    const { cache } = services;
    const store = services.storage.blocklists;
    const source = 'blocklist' as const;

    // With a database this is a no-op; the in-memory store downloads the
    // address lists here the first time they are needed.
    await store.prepare('address');
    // A database answer is worth caching for a few minutes; memory is read
    // directly, so a list that finishes loading counts from the next call.
    const inMemory = services.storage.info.kind === 'memory';
    const loaded = new Set(
      inMemory
        ? await loadedLists(store)
        : // "Nothing loaded" throws and so is not cached: the first refresh may finish any minute.
          await cache.wrap('blocklist_meta', 'loaded', META_TTL_SECS, () => loadedLists(store)),
    );
    // Without the sanctions list a "not listed" answer would be a guess.
    if (!loaded.has(metaName('ofac', 'address'))) {
      throw new CollectorUnavailable('the sanctions list has not been loaded yet');
    }

    const address = normaliseAddress(subject.recipient);
    const lookup = async () => (await store.lookupAddresses([address])).map((hit) => hit.list);
    const hits = inMemory
      ? await lookup()
      : await cache.wrap('blocklist', address, ADDRESS_TTL_SECS, lookup);

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
    if (domains.length > 0) await store.prepare('domain');
    for (const domain of domains) {
      const listed = await findListedDomain(store, domain).catch(() => null);
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
