import { describe, expect, it } from 'vitest';

import {
  DOMAIN_SHARDS,
  buildDomainShards,
  domainCandidates,
  extractDomains,
  hashDomain,
  normaliseAddress,
  normaliseDomain,
  packHashes,
  packedHas,
  parseAddressLines,
  parseMetaMaskConfig,
  parsePhantomYaml,
  parseStringArray,
  shardOf,
  unpackShard,
} from '../src/collectors/blocklist-parse';

describe('list parsers', () => {
  it('reads the Phantom YAML', () => {
    const yaml = [
      '# Phantom blocklist',
      '- url: phantom-airdrop.example',
      '- url: "claim.fake-jup.example"',
      '  - url: nested.example # trailing comment',
      'not a list entry',
      '',
    ].join('\n');
    expect(parsePhantomYaml(yaml)).toEqual([
      'phantom-airdrop.example',
      'claim.fake-jup.example',
      'nested.example',
    ]);
  });

  it('reads a JSON string array and skips non-strings', () => {
    expect(parseStringArray('["a.example","b.example",42,null]')).toEqual([
      'a.example',
      'b.example',
    ]);
    expect(() => parseStringArray('{"domains":[]}')).toThrow();
    expect(() => parseStringArray('<html>rate limited</html>')).toThrow();
  });

  it('reads the MetaMask config blacklist', () => {
    const config = JSON.stringify({
      version: 2,
      tolerance: 1,
      fuzzylist: ['metamask.io'],
      whitelist: ['metamask.io'],
      blacklist: ['metarnask.example', 'wallet-verify.example'],
    });
    expect(parseMetaMaskConfig(config)).toEqual(['metarnask.example', 'wallet-verify.example']);
    expect(() => parseMetaMaskConfig('{"whitelist":[]}')).toThrow();
  });

  it('reads one address per line', () => {
    const text =
      '# OFAC\n\n  FepMPR8vahkJ98Fr1GBwG9dKrVbzoGCGDSkmBjwsmkVv  \n0xAbCd000000000000000000000000000000000001\n';
    expect(parseAddressLines(text)).toEqual([
      'FepMPR8vahkJ98Fr1GBwG9dKrVbzoGCGDSkmBjwsmkVv',
      '0xAbCd000000000000000000000000000000000001',
    ]);
  });
});

describe('address normalisation', () => {
  it('keeps base58 exactly and lowercases hex', () => {
    expect(normaliseAddress(' FepMPR8vahkJ98Fr1GBwG9dKrVbzoGCGDSkmBjwsmkVv ')).toBe(
      'FepMPR8vahkJ98Fr1GBwG9dKrVbzoGCGDSkmBjwsmkVv',
    );
    expect(normaliseAddress('0xAbCd000000000000000000000000000000000001')).toBe(
      '0xabcd000000000000000000000000000000000001',
    );
  });
});

describe('domain normalisation', () => {
  it('strips scheme, www, port, path, query and case', () => {
    expect(normaliseDomain('HTTPS://www.Evil.Example:443/claim?x=1#top')).toBe('evil.example');
    expect(normaliseDomain('evil.example.')).toBe('evil.example');
    expect(normaliseDomain('user@evil.example/path')).toBe('evil.example');
    expect(normaliseDomain('sub.evil.example')).toBe('sub.evil.example');
  });

  it('rejects things that are not domains', () => {
    expect(normaliseDomain('localhost')).toBeNull();
    expect(normaliseDomain('not a domain')).toBeNull();
    expect(normaliseDomain('')).toBeNull();
  });

  it('lists the domain and its parents down to two labels', () => {
    expect(domainCandidates('a.b.evil.example')).toEqual([
      'a.b.evil.example',
      'b.evil.example',
      'evil.example',
    ]);
    expect(domainCandidates('evil.example')).toEqual(['evil.example']);
  });

  it('finds domains in free text', () => {
    const text =
      'Support told me to log in at https://Phantom-Verify.example/login and wallet.fake.example. Thanks';
    expect(extractDomains(text)).toEqual(['phantom-verify.example', 'wallet.fake.example']);
    expect(extractDomains('rent for November, 12.50 USDC')).toEqual([]);
  });
});

describe('hashed domain sets', () => {
  const listed = [
    'evil.example',
    'https://www.Drainer.example/x',
    'claim.airdrop.example',
    'evil.example',
  ];
  const { shards, count } = buildDomainShards(listed);

  /** The lookup the collector does, against in-memory shards. */
  const isListed = (domain: string) =>
    domainCandidates(domain).some((candidate) => {
      const hash = hashDomain(candidate);
      return packedHas(unpackShard(shards[shardOf(hash)]!), hash);
    });

  it('builds one packed shard per bucket and de-duplicates', () => {
    expect(shards).toHaveLength(DOMAIN_SHARDS);
    expect(count).toBe(3);
  });

  it('matches a listed domain exactly', () => {
    expect(isListed('evil.example')).toBe(true);
    expect(isListed('drainer.example')).toBe(true);
    expect(isListed('claim.airdrop.example')).toBe(true);
  });

  it('matches subdomains of a listed domain by suffix', () => {
    expect(isListed('login.evil.example')).toBe(true);
    expect(isListed('a.b.c.drainer.example')).toBe(true);
  });

  it('does not match a parent, a sibling or a look-alike of a listed domain', () => {
    expect(isListed('airdrop.example')).toBe(false);
    expect(isListed('other.airdrop.example')).toBe(false);
    expect(isListed('notevil.example')).toBe(false);
    expect(isListed('evil.example.org')).toBe(false);
    expect(isListed('example')).toBe(false);
  });

  it('finds every member of a large shard by binary search', () => {
    const domains = Array.from({ length: 5_000 }, (_, i) => `site-${i}.example`);
    const hashes = domains.map(hashDomain);
    expect(new Set(hashes).size).toBe(domains.length);
    const packed = unpackShard(packHashes(hashes));
    expect(packed.length).toBe(domains.length * 8);
    for (const hash of hashes) expect(packedHas(packed, hash)).toBe(true);
    expect(packedHas(packed, hashDomain('absent.example'))).toBe(false);
  });
});
