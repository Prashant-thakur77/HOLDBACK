/**
 * Hourly refresh of the static lists. One list failing leaves its previous
 * copy in place (stale beats empty) and does not stop the others.
 */
import { request } from '../lib/http';
import type { BlocklistWriter, ListKind } from '../store/types';
import {
  buildDomainShards,
  normaliseAddress,
  parseAddressLines,
  parseMetaMaskConfig,
  parsePhantomYaml,
  parseStringArray,
} from './blocklist-parse';

const GITHUB_RAW = 'https://raw.githubusercontent.com';
const OFAC_BASE = `${GITHUB_RAW}/0xB10C/ofac-sanctioned-digital-currency-addresses/lists`;
/** Chains of the OFAC mirror that are loaded. */
export const OFAC_CHAINS = ['SOL', 'ETH', 'XBT', 'USDT', 'USDC', 'TRX'] as const;

interface DomainSource {
  list: string;
  kind: 'domain';
  url: string;
  parse: (text: string) => string[];
}
interface AddressSource {
  list: string;
  kind: 'address';
  urls: string[];
  parse: (text: string) => string[];
}

/** The lists and where they come from. `list` is the value stored in the database. */
export const SOURCES: (DomainSource | AddressSource)[] = [
  {
    list: 'ofac',
    kind: 'address',
    urls: OFAC_CHAINS.map((chain) => `${OFAC_BASE}/sanctioned_addresses_${chain}.txt`),
    parse: parseAddressLines,
  },
  {
    list: 'scamsniffer',
    kind: 'address',
    urls: [`${GITHUB_RAW}/scamsniffer/scam-database/main/blacklist/address.json`],
    parse: parseStringArray,
  },
  {
    list: 'scamsniffer',
    kind: 'domain',
    url: `${GITHUB_RAW}/scamsniffer/scam-database/main/blacklist/domains.json`,
    parse: parseStringArray,
  },
  {
    list: 'phantom',
    kind: 'domain',
    url: `${GITHUB_RAW}/phantom/blocklist/master/blocklist.yaml`,
    parse: parsePhantomYaml,
  },
  {
    list: 'metamask',
    kind: 'domain',
    url: `${GITHUB_RAW}/MetaMask/eth-phishing-detect/main/src/config.json`,
    parse: parseMetaMaskConfig,
  },
];

/** Lists that hold domains, in the order they are checked. */
export const DOMAIN_LISTS = SOURCES.filter((source) => source.kind === 'domain').map(
  (source) => source.list,
);

/** `blocklist_meta.list` for a source: address and domain halves are tracked apart. */
export const metaName = (list: string, kind: 'address' | 'domain') => `${list}_${kind}`;

export interface RefreshResult {
  list: string;
  kind: 'address' | 'domain';
  ok: boolean;
  entries: number;
  error?: string;
}

async function download(url: string): Promise<string> {
  const response = await request(url, { timeoutMs: 25_000 });
  return response.text();
}

async function refreshOne(
  store: BlocklistWriter,
  source: DomainSource | AddressSource,
): Promise<number> {
  if (source.kind === 'address') {
    const values = new Set<string>();
    const files = await Promise.all(source.urls.map(download));
    for (const file of files) {
      for (const address of source.parse(file)) values.add(normaliseAddress(address));
    }
    // An empty answer is treated as a broken download, not as "nobody is listed".
    if (values.size === 0) throw new Error('list came back empty');
    await store.replaceAddresses(source.list, [...values]);
    await store.saveMeta(metaName(source.list, 'address'), values.size, source.urls[0]!);
    return values.size;
  }
  const { shards, count } = buildDomainShards(source.parse(await download(source.url)));
  if (count === 0) throw new Error('list came back empty');
  await store.saveDomainShards(source.list, shards);
  await store.saveMeta(metaName(source.list, 'domain'), count, source.url);
  return count;
}

/**
 * Refreshes every list (or only the lists of one kind), one at a time to
 * keep memory flat. The store decides where the entries live.
 */
export async function refreshBlocklists(
  store: BlocklistWriter,
  only?: ListKind,
): Promise<RefreshResult[]> {
  const results: RefreshResult[] = [];
  for (const source of SOURCES.filter((candidate) => !only || candidate.kind === only)) {
    try {
      const entries = await refreshOne(store, source);
      results.push({ list: source.list, kind: source.kind, ok: true, entries });
    } catch (error) {
      results.push({
        list: source.list,
        kind: source.kind,
        ok: false,
        entries: 0,
        error: error instanceof Error ? error.message : 'failed',
      });
    }
  }
  return results;
}
