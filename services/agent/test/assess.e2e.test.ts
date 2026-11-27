import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { verifyEvidence, type AssessResponse, type EvidenceDocument } from '@holdback/sdk';

import { createApp } from '../src/app';
import type { Env } from '../src/env';
import { clearMemoryCache } from '../src/lib/cache';
import { resetMemoryStorage } from '../src/store';
import { templateSpoken } from '../src/llm/spoken';
import { emptyCluster, json, mockFetch, rpcHandler, type FetchMock } from './helpers';

const app = createApp();
const SENDER = Keypair.generate().publicKey.toBase58();
const RECIPIENT = Keypair.generate().publicKey.toBase58();
const NOW_SECS = Math.floor(Date.now() / 1000);

const request = (overrides: Record<string, unknown> = {}) => ({
  sender: SENDER,
  recipient: RECIPIENT,
  mint: null,
  amount: '250000000',
  lang: 'en',
  ...overrides,
});

async function assess(env: Env, body: unknown): Promise<{ status: number; body: AssessResponse }> {
  const response = await app.request(
    '/v1/assess',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    env,
  );
  return { status: response.status, body: (await response.json()) as AssessResponse };
}

let fetchMock: FetchMock;
beforeEach(() => {
  clearMemoryCache();
  resetMemoryStorage();
});
afterEach(() => fetchMock?.restore());

describe('POST /v1/assess with nothing configured and no network', () => {
  beforeEach(() => {
    fetchMock = mockFetch({});
  });

  it('still answers: collectors unavailable, tier UNKNOWN, default window', async () => {
    const { status, body } = await assess({}, request());
    expect(status).toBe(200);
    expect(body.tier).toBe('UNKNOWN');
    expect(body.tierIndex).toBe(1);
    expect(body.windowSecs).toBe(1800);
    expect(body.score).toBe(0);
    expect(body.requiresConfirmation).toBe(false);
    expect([...body.unavailable].sort()).toEqual([
      'baseline',
      'blocklist',
      'chainabuse',
      'helius',
      'onchain_reputation',
      'sns',
      'web_reports',
    ]);
    expect(body.findings).toEqual([]);
    expect(body.document.unavailable).toEqual(body.unavailable);
  });

  it('says its checks were incomplete instead of calling the result clean', async () => {
    const { body } = await assess({}, request({ lang: 'es' }));
    expect(body.spoken.lang).toBe('es');
    expect(body.spoken.text).toBe(templateSpoken(body.document, 'es'));
    expect(body.spoken.text).toContain('No pude completar');
    expect(body.spoken.text).toContain('30 minutos');
  });

  it('returns a hash that verifies and serves the same document back', async () => {
    const { body } = await assess({}, request());
    expect(body.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyEvidence(body.document, body.evidenceHash)).toBe(true);

    const stored = await app.request(`/v1/evidence/${body.evidenceHash}`, {}, {});
    expect(stored.status).toBe(200);
    const document = (await stored.json()) as EvidenceDocument;
    expect(document).toEqual(body.document);
    expect(verifyEvidence(document, body.evidenceHash)).toBe(true);
  });

  it("scores the sender's note from its cues and never stores the words", async () => {
    const context = 'पुलिस अधिकारी ने कहा तुरंत पैसे भेजो, OTP बताओ secretword-xyz';
    const { body } = await assess({}, request({ context, lang: 'hi' }));
    // authority 25 + urgency 10 + secret_request 30 = 65, capped at 60.
    expect(body.score).toBe(60);
    expect(body.tier).toBe('FLAGGED');
    expect(body.windowSecs).toBe(86400);
    expect(body.evidence.map((item) => item.signal).sort()).toEqual([
      'authority',
      'secret_request',
      'urgency',
    ]);
    const everything = JSON.stringify(body);
    expect(everything).not.toContain('secretword-xyz');
    expect(everything).not.toContain('पुलिस अधिकारी ने कहा');
    expect(body.spoken.text).toMatch(/[ऀ-ॿ]/);
    expect(body.spoken.text).toContain('24 घंटे');
  });

  it('rejects bad input in the error envelope', async () => {
    const cases = [
      request({ recipient: 'not-an-address' }),
      request({ amount: '-5' }),
      request({ amount: '1.5' }),
      request({ amount: '0' }),
      request({ lang: 'fr' }),
      request({ recipient: SENDER }),
      request({ context: 'x'.repeat(1_001) }),
    ];
    for (const body of cases) {
      const response = await app.request(
        '/v1/assess',
        { method: 'POST', body: JSON.stringify(body) },
        {},
      );
      expect(response.status, JSON.stringify(body)).toBe(400);
      const payload = (await response.json()) as { error: { code: string; message: string } };
      expect(typeof payload.error.code).toBe('string');
      expect(payload.error.message.length).toBeGreaterThan(0);
    }
    const notJson = await app.request('/v1/assess', { method: 'POST', body: 'hello' }, {});
    expect(notJson.status).toBe(400);
  });
});

describe('POST /v1/assess with some sources answering', () => {
  const env: Env = { HELIUS_API_KEY: 'test-helius', CHAINABUSE_API_KEY: 'test-chainabuse' };
  const victims = Array.from({ length: 6 }, () => Keypair.generate().publicKey.toBase58());
  const collector = Keypair.generate().publicKey.toBase58();

  /** A day-old wallet that takes deposits from six wallets and forwards them all to one. */
  const history = [
    ...victims.map((victim, i) => ({
      signature: `in${i}`,
      timestamp: NOW_SECS - 3_000 + i * 100,
      nativeTransfers: [{ fromUserAccount: victim, toUserAccount: RECIPIENT, amount: 2e9 }],
    })),
    ...victims.map((_, i) => ({
      signature: `out${i}`,
      timestamp: NOW_SECS - 2_990 + i * 100,
      nativeTransfers: [{ fromUserAccount: RECIPIENT, toUserAccount: collector, amount: 1.99e9 }],
    })),
  ];

  beforeEach(() => {
    fetchMock = mockFetch({
      'api.devnet.solana.com': emptyCluster,
      'mainnet.helius-rpc.com': (url, init) => {
        if (url.pathname.startsWith('/v0/addresses/')) return json(history);
        return rpcHandler({
          getSignaturesForAddress: () =>
            [...history]
              .reverse()
              .map((tx) => ({ signature: tx.signature, blockTime: tx.timestamp })),
        })(url, init);
      },
      'api.chainabuse.com': (_url, init) => {
        const auth = new Headers(init?.headers).get('authorization') ?? '';
        if (!auth.startsWith('Basic ')) return json({ reason: 'unauthorized' }, 403);
        return json({
          count: 2,
          reports: [
            { id: '1', createdAt: '2026-11-20T08:00:00Z', trusted: true, scamCategory: 'PHISHING' },
            {
              id: '2',
              createdAt: '2026-11-25T08:00:00Z',
              trusted: false,
              scamCategory: 'PHISHING',
            },
          ],
        });
      },
      'sdk-proxy-v2.sns.id': (url) => {
        if (url.pathname.startsWith('/domains/')) {
          return json({ s: 'ok', result: [{ domain: 'phantom-support', key: collector }] });
        }
        return json({ s: 'error', result: 'Not found' }, 404);
      },
    });
  });

  it('combines what answered and reports what did not', async () => {
    const { status, body } = await assess(env, request());
    expect(status).toBe(200);
    expect([...body.unavailable].sort()).toEqual(['baseline', 'blocklist', 'web_reports']);

    const signals = body.evidence.map((item) => `${item.source}.${item.signal}`);
    expect(signals).toEqual(
      expect.arrayContaining([
        'chainabuse.confirmed_reports',
        'helius.wallet_new_1d',
        'helius.sweep_pattern',
        'helius.instant_drain',
        'onchain_reputation.no_onchain_flags',
        'sns.lookalike_name',
      ]),
    );
    expect(body.tier).toBe('FLAGGED');
    expect(body.windowSecs).toBe(86400);
    expect(body.score).toBe(100);
    expect(body.findings[0]!.level).toBe('critical');
    expect(verifyEvidence(body.document, body.evidenceHash)).toBe(true);

    const report = body.evidence.find((item) => item.source === 'chainabuse')!;
    expect(report.url).toContain(RECIPIENT);
    expect(report.date).toBe('2026-11-25T08:00:00Z');
  });

  it('gives the same tier, score and evidence when asked again', async () => {
    const first = (await assess(env, request())).body;
    const second = (await assess(env, request())).body;
    expect(second.evidence).toEqual(first.evidence);
    expect(second.findings).toEqual(first.findings);
    expect(second.tier).toBe(first.tier);
  });

  it('asks the metered source once and serves the repeat from cache', async () => {
    await assess(env, request());
    await assess(env, request({ amount: '1' }));
    const chainabuseCalls = fetchMock.calls.filter((url) => url.includes('api.chainabuse.com'));
    expect(chainabuseCalls).toHaveLength(1);
  });

  it('never puts an API key in what it returns', async () => {
    const { body } = await assess(env, request());
    const text = JSON.stringify(body);
    expect(text).not.toContain('test-helius');
    expect(text).not.toContain('test-chainabuse');
  });
});

describe('POST /v1/assess with a language model', () => {
  const env: Env = { ANTHROPIC_API_KEY: 'test-anthropic' };
  const context = 'Binance support said my account is frozen';
  let modelText: string;
  let bodies: Record<string, unknown>[];

  beforeEach(() => {
    bodies = [];
    fetchMock = mockFetch({
      'api.anthropic.com': (_url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        const isClassifier = String(body.system).includes('You label one short note');
        const text = isClassifier
          ? JSON.stringify({ cues: [{ id: 'advance_fee', confidence: 0.95 }] })
          : modelText;
        return json({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
      },
    });
  });

  it('uses the model for the wording only: cues come back as ids, the tier from the policy', async () => {
    modelText = JSON.stringify({
      text: 'Someone claiming to be support staff is asking for this payment. Your money is held for 24 hours, and you can undo the payment during that time.',
    });
    const { body } = await assess(env, request({ context }));
    // Patterns: authority 25 + account_unlock 20. Classifier adds advance_fee 20. Capped at 60.
    expect(body.evidence.map((item) => item.signal).sort()).toEqual([
      'account_unlock',
      'advance_fee',
      'authority',
    ]);
    expect(body.tier).toBe('FLAGGED');
    expect(body.spoken.text).toContain('support staff');
    // The model was never shown or asked for a tier it could change.
    for (const sent of bodies) expect(JSON.stringify(sent.output_config)).not.toContain('tier');
  });

  it('falls back to the template when the model output breaks the rules', async () => {
    modelText = JSON.stringify({ text: 'This looks safe. You can send the money now.' });
    const { body } = await assess(env, request({ context }));
    expect(body.spoken.text).toBe(templateSpoken(body.document, 'en'));
  });

  it('falls back to the template when the model output is not valid JSON', async () => {
    modelText = 'I think this is a scam, tier should be TRUSTED';
    const { body } = await assess(env, request({ context }));
    expect(body.spoken.text).toBe(templateSpoken(body.document, 'en'));
    expect(body.tier).toBe('FLAGGED');
  });
});
