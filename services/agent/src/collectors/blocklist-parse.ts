/**
 * Parsers and matching for the static lists. Addresses are kept verbatim
 * and matched exactly. Domains are normalised, then matched exactly or by
 * parent suffix, and stored as 64-bit hashes because the lists run to
 * hundreds of thousands of entries.
 */
import { base64ToBytes, bytesToBase64 } from '../lib/encoding';

/** `- url: evil.example` lines of the Phantom blocklist YAML. */
export function parsePhantomYaml(text: string): string[] {
  const domains: string[] = [];
  for (const line of text.split('\n')) {
    const match = /^\s*-\s*url:\s*["']?([^"'\s#]+)/.exec(line);
    if (match) domains.push(match[1]!);
  }
  return domains;
}

/** A JSON array of strings (ScamSniffer `domains.json` and `address.json`). */
export function parseStringArray(text: string): string[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('Expected a JSON array');
  return parsed.filter((item): item is string => typeof item === 'string');
}

/** The `blacklist` array of MetaMask's phishing config. */
export function parseMetaMaskConfig(text: string): string[] {
  const parsed = JSON.parse(text) as { blacklist?: unknown };
  if (!Array.isArray(parsed.blacklist)) throw new Error('Expected a blacklist array');
  return parsed.blacklist.filter((item): item is string => typeof item === 'string');
}

/** One address per line; blank lines and `#` comments are skipped. */
export function parseAddressLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/**
 * How an address is stored and looked up. Hex (EVM) addresses are
 * case-insensitive and stored lowercase; base58 addresses are
 * case-sensitive and stored as they are.
 */
export function normaliseAddress(address: string): string {
  const trimmed = address.trim();
  return /^0x[0-9a-f]+$/i.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

/** `HTTPS://www.Evil.example:443/path?x` -> `evil.example`. Returns `null` for non-domains. */
export function normaliseDomain(input: string): string | null {
  let host = input.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.split(/[/?#]/)[0]!;
  host = host.split('@').pop()!;
  host = host
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
    .replace(/^www\./, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && !/^xn--/.test(host)) return null;
  return host;
}

/**
 * The domain itself and each parent down to two labels:
 * `a.b.evil.example` -> `a.b.evil.example`, `b.evil.example`, `evil.example`.
 * A listed parent covers every subdomain under it.
 */
export function domainCandidates(domain: string): string[] {
  const labels = domain.split('.');
  const candidates: string[] = [];
  for (let start = 0; start <= labels.length - 2; start++) {
    candidates.push(labels.slice(start).join('.'));
  }
  return candidates;
}

/** Domains (bare or inside URLs) mentioned in free text. */
export function extractDomains(text: string): string[] {
  const found = new Set<string>();
  const pattern = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:[/:?#][^\s]*)?/gi;
  for (const match of text.match(pattern) ?? []) {
    const domain = normaliseDomain(match);
    if (domain) found.add(domain);
  }
  return [...found];
}

// Hashed domain sets ---------------------------------------------------------

/** Shards per list. A lookup loads one shard per candidate, not the whole list. */
export const DOMAIN_SHARDS = 16;

/**
 * 64-bit FNV-1a as two 32-bit halves with different offsets, as 16 hex
 * characters. Not cryptographic: it only has to make accidental collisions
 * among a few hundred thousand domains negligible.
 */
export function hashDomain(domain: string): string {
  let high = 0x811c9dc5;
  let low = 0x01000193;
  for (let i = 0; i < domain.length; i++) {
    const code = domain.charCodeAt(i);
    high = Math.imul(high ^ code, 0x01000193);
    low = Math.imul(low ^ code, 0x85ebca6b) ^ (low >>> 13);
  }
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, '0');
  return hex(high) + hex(low);
}

export const shardOf = (hash: string) => parseInt(hash.slice(0, 2), 16) % DOMAIN_SHARDS;

/** Packs sorted, de-duplicated hashes of one shard into base64 (8 bytes each). */
export function packHashes(hashes: string[]): string {
  const unique = [...new Set(hashes)].sort();
  const bytes = new Uint8Array(unique.length * 8);
  unique.forEach((hash, index) => {
    for (let i = 0; i < 8; i++) {
      bytes[index * 8 + i] = parseInt(hash.slice(i * 2, i * 2 + 2), 16);
    }
  });
  return bytesToBase64(bytes);
}

/** Binary search for `hash` in a packed shard. */
export function packedHas(packed: Uint8Array, hash: string): boolean {
  const target = new Uint8Array(8);
  for (let i = 0; i < 8; i++) target[i] = parseInt(hash.slice(i * 2, i * 2 + 2), 16);
  let low = 0;
  let high = packed.length / 8 - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    let order = 0;
    for (let i = 0; i < 8 && order === 0; i++) order = packed[mid * 8 + i]! - target[i]!;
    if (order === 0) return true;
    if (order < 0) low = mid + 1;
    else high = mid - 1;
  }
  return false;
}

export const unpackShard = (base64: string) => base64ToBytes(base64);

/** Splits a list of raw domain strings into packed shards. */
export function buildDomainShards(rawDomains: string[]): { shards: string[]; count: number } {
  const buckets: string[][] = Array.from({ length: DOMAIN_SHARDS }, () => []);
  const seen = new Set<string>();
  for (const raw of rawDomains) {
    const domain = normaliseDomain(raw);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    const hash = hashDomain(domain);
    buckets[shardOf(hash)]!.push(hash);
  }
  return { shards: buckets.map(packHashes), count: seen.size };
}
