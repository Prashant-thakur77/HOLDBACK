import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { verifyEvidence, type EvidenceDocument } from '@holdback/sdk';

import { createApp } from '../src/app';
import type { Assessment } from '../src/assess';
import type { Env } from '../src/env';
import { clearMemoryCache } from '../src/lib/cache';
import { createServices } from '../src/services';
import { MEMORY_STORAGE_NOTICE, resetMemoryStorage } from '../src/store';
import { MAX_EVIDENCE_DOCUMENTS, MemoryBlocklists, MemoryEvidence } from '../src/store/memory';
import { json, mockFetch, type FetchMock, type Handler } from './helpers';

const app = createApp();
const address = () => Keypair.generate().publicKey.toBase58();

const SENDER = address();
const SANCTIONED = address();
const SCAM_LISTED = address();
const ORDINARY = address();

interface Lists {
  /** Requests that fail, by a fragment of their path. */
  failing?: string[];
}

/** The public list files, served from fixtures. Only tests replace `fetch`. */
function listHost(options: Lists = {}): Handler {
  return (url) => {
    const path = url.pathname;
    if ((options.failing ?? []).some((fragment) => path.includes(fragment))) {
      return new Response('rate limited', { status: 429 });
    }
    if (path.endsWith('sanctioned_addresses_SOL.txt')) {
      return new Response(`${address()}\n${SANCTIONED}\n`);
    }
    if (path.includes('sanctioned_addresses_')) {
      return new Response('0xAbCd000000000000000000000000000000000001\n');
    }
    if (path.endsWith('blacklist/address.json')) return json([SCAM_LISTED, '0xDEADbeef']);
    if (path.endsWith('blacklist/domains.json')) return json(['wallet-drainer.example']);
    if (path.endsWith('blocklist.yaml')) return new Response('- url: phantom-claim.example\n');
    if (path.endsWith('config.json')) return json({ blacklist: ['metarnask.example'] });
    return new Response('not found', { status: 404 });
  };
}

async function assess(env: Env, recipient: string, context?: string) {
  const response = await app.request(
    '/v1/assess',
    {
      method: 'POST',
      body: JSON.stringify({
        sender: SENDER,
        recipient,
        mint: null,
        amount: '1000000',
        lang: 'en',
        context,
      }),
    },
    env,
  );
  return { response, body: (await response.json()) as Assessment };
}

const fetched = (mock: FetchMock, fragment: string) =>
  mock.calls.filter((url) => url.includes(fragment)).length;

let fetchMock: FetchMock | undefined;
beforeEach(() => {
  clearMemoryCache();
  resetMemoryStorage();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  fetchMock?.restore();
  vi.restoreAllMocks();
});

describe('store selection', () => {
  it('uses memory when Supabase is not configured, and says it does not persist', () => {
    const services = createServices({});
    expect(services.db).toBeNull();
    expect(services.storage.info).toEqual({ kind: 'memory', persistent: false });
    expect(console.warn).toHaveBeenCalledWith(MEMORY_STORAGE_NOTICE);
    expect(MEMORY_STORAGE_NOTICE).toContain('NOT PERSISTENT');
  });

  it('needs both Supabase settings before it uses the database', () => {
    expect(createServices({ SUPABASE_URL: 'https://db.example' }).storage.info.kind).toBe('memory');
    expect(createServices({ SUPABASE_SERVICE_ROLE_KEY: 'key' }).storage.info.kind).toBe('memory');
    const configured = createServices({
      SUPABASE_URL: 'https://db.example',
      SUPABASE_SERVICE_ROLE_KEY: 'key',
    });
    expect(configured.db).not.toBeNull();
    expect(configured.storage.info).toEqual({ kind: 'supabase', persistent: true });
  });

  it('shares one in-memory store across requests and announces it once', () => {
    const first = createServices({});
    const second = createServices({});
    expect(second.storage.evidence).toBe(first.storage.evidence);
    expect(second.storage.blocklists).toBe(first.storage.blocklists);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('never answers from memory when the database is configured', async () => {
    const hash = 'a'.repeat(64);
    const document = { policyVersion: 'x' } as EvidenceDocument;
    await createServices({}).storage.evidence.put(hash, { document, spoken: {} });

    fetchMock = mockFetch({ 'db.example': () => json(null) });
    const env: Env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'key' };
    expect(await createServices(env).storage.evidence.get(hash)).toBeNull();
    expect(fetched(fetchMock, 'db.example/rest/v1/evidence')).toBe(1);

    // A database error is an error, not a reason to fall back to memory.
    fetchMock.restore();
    fetchMock = mockFetch({ 'db.example': () => json({ message: 'down' }, 500) });
    await expect(createServices(env).storage.evidence.get(hash)).rejects.toThrow();
  });
});

describe('POST /v1/assess without a database', () => {
  beforeEach(() => {
    fetchMock = mockFetch({ 'raw.githubusercontent.com': listHost() });
  });

  it('rates an OFAC-listed address SANCTIONED from the downloaded list', async () => {
    const { response, body } = await assess({}, SANCTIONED);
    expect(response.status).toBe(200);
    expect(body.tier).toBe('SANCTIONED');
    expect(body.tierIndex).toBe(4);
    expect(body.windowSecs).toBe(259200);
    expect(body.requiresConfirmation).toBe(true);
    const hit = body.evidence.find((item) => item.signal === 'ofac_sanctioned')!;
    expect(hit).toMatchObject({ source: 'blocklist', matched: SANCTIONED, weight: 100 });
    expect(body.spoken.text).toContain('sanctions list');
  });

  it('labels the answer as coming from non-persistent storage', async () => {
    const { response, body } = await assess({}, SANCTIONED);
    expect(body.storage).toEqual({ kind: 'memory', persistent: false });
    expect(response.headers.get('x-holdback-storage')).toBe('memory');
    const root = await app.request('/', {}, {});
    expect(((await root.json()) as { storage: unknown }).storage).toEqual(body.storage);
  });

  it('keeps `unavailable` truthful: lists answered, sender history did not', async () => {
    const { body } = await assess({}, SANCTIONED);
    expect(body.unavailable).not.toContain('blocklist');
    expect(body.unavailable).toContain('baseline');
    expect(body.document.unavailable).toEqual(body.unavailable);
  });

  it('matches addresses exactly', async () => {
    const ordinary = (await assess({}, ORDINARY)).body;
    expect(ordinary.tier).toBe('UNKNOWN');
    expect(ordinary.evidence.map((item) => item.signal)).toContain('not_listed');
    expect(ordinary.unavailable).not.toContain('blocklist');

    const listed = (await assess({}, SCAM_LISTED)).body;
    expect(listed.tier).toBe('FLAGGED');
    expect(listed.evidence.find((item) => item.signal === 'scam_list_address')!.detail).toContain(
      'scamsniffer',
    );
  });

  it('downloads the address lists once and reuses them', async () => {
    await assess({}, SANCTIONED);
    await assess({}, ORDINARY);
    await assess({}, SCAM_LISTED);
    expect(fetched(fetchMock!, 'sanctioned_addresses_SOL.txt')).toBe(1);
    expect(fetched(fetchMock!, 'blacklist/address.json')).toBe(1);
  });

  it('downloads the large domain lists only when a note names a site', async () => {
    await assess({}, ORDINARY, 'rent for November');
    expect(fetched(fetchMock!, 'domains.json')).toBe(0);
    expect(fetched(fetchMock!, 'config.json')).toBe(0);

    const { body } = await assess(
      {},
      ORDINARY,
      'they told me to log in at https://login.wallet-drainer.example/claim',
    );
    expect(fetched(fetchMock!, 'domains.json')).toBe(1);
    const hit = body.evidence.find((item) => item.signal === 'phishing_domain_in_context')!;
    expect(hit).toMatchObject({ matched: 'wallet-drainer.example', weight: 40 });
    expect(body.tier).toBe('SUSPICIOUS');
  });
});

describe('when the lists cannot be downloaded', () => {
  it('reports the collector unavailable instead of "not listed"', async () => {
    fetchMock = mockFetch({});
    const { body } = await assess({}, SANCTIONED);
    expect(body.unavailable).toContain('blocklist');
    expect(body.tier).toBe('UNKNOWN');
    expect(body.evidence.map((item) => item.signal)).not.toContain('not_listed');
  });

  it('does the same when only the sanctions list is missing', async () => {
    fetchMock = mockFetch({
      'raw.githubusercontent.com': listHost({ failing: ['sanctioned_addresses_'] }),
    });
    const { body } = await assess({}, SCAM_LISTED);
    expect(body.unavailable).toContain('blocklist');
    expect(body.evidence.map((item) => item.source)).not.toContain('blocklist');
  });

  it('does not retry on every request while the source is down', async () => {
    fetchMock = mockFetch({});
    await assess({}, SANCTIONED);
    const attempts = fetched(fetchMock, 'sanctioned_addresses_SOL.txt');
    await assess({}, ORDINARY);
    await assess({}, SCAM_LISTED);
    expect(attempts).toBe(1);
    expect(fetched(fetchMock, 'sanctioned_addresses_SOL.txt')).toBe(1);
  });

  it('keeps the copy it has when a refresh fails', async () => {
    fetchMock = mockFetch({ 'raw.githubusercontent.com': listHost() });
    const store = new MemoryBlocklists();
    await store.prepare('address');
    expect(await store.lookupAddresses([SANCTIONED, ORDINARY])).toEqual([
      { list: 'ofac', value: SANCTIONED },
    ]);

    fetchMock.restore();
    fetchMock = mockFetch({});
    const results = await store.refresh();
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(await store.lookupAddresses([SANCTIONED])).toEqual([
      { list: 'ofac', value: SANCTIONED },
    ]);
    // Domain lists were never needed, so the refresh did not fetch them.
    expect(results.map((result) => result.kind)).toEqual(['address', 'address']);
  });
});

describe('evidence in memory', () => {
  beforeEach(() => {
    fetchMock = mockFetch({ 'raw.githubusercontent.com': listHost() });
  });

  it('round-trips through GET /v1/evidence/:hash and still verifies', async () => {
    const { body } = await assess({}, SANCTIONED);
    const response = await app.request(`/v1/evidence/${body.evidenceHash}`, {}, {});
    expect(response.status).toBe(200);
    expect(response.headers.get('x-holdback-storage')).toBe('memory');
    const document = (await response.json()) as EvidenceDocument;
    expect(document).toEqual(body.document);
    expect(verifyEvidence(document, body.evidenceHash)).toBe(true);
  });

  it('answers 404 for a hash it never stored', async () => {
    const response = await app.request(`/v1/evidence/${'0'.repeat(64)}`, {}, {});
    expect(response.status).toBe(404);
  });

  it('does not survive a restart', async () => {
    const { body } = await assess({}, ORDINARY);
    resetMemoryStorage();
    const response = await app.request(`/v1/evidence/${body.evidenceHash}`, {}, {});
    expect(response.status).toBe(404);
  });

  it('keeps a bounded number of documents, dropping the oldest', async () => {
    const store = new MemoryEvidence();
    const document = {} as EvidenceDocument;
    for (let i = 0; i <= MAX_EVIDENCE_DOCUMENTS; i++) {
      await store.put(`hash-${i}`, { document, spoken: {} });
    }
    expect(await store.get('hash-0')).toBeNull();
    expect(await store.get('hash-1')).not.toBeNull();
    expect(await store.get(`hash-${MAX_EVIDENCE_DOCUMENTS}`)).not.toBeNull();
  });
});
