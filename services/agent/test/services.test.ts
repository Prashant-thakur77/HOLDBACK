import { ed25519 } from '@noble/curves/ed25519';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { Tier, encodeBase58 } from '@holdback/sdk';

import { createApp } from '../src/app';
import { signInMessage, verifyWalletSignature } from '../src/auth';
import { extendedReleaseAt } from '../src/chain/oracle';
import { relayWindowSecs } from '../src/chain/relayer';
import { baselineSignals, buildBaseline } from '../src/collectors/baseline';
import { reportSignals, summarise } from '../src/collectors/chainabuse';
import { reputationSignals } from '../src/collectors/onchain';
import type { PaymentHistory } from '../src/db/holds';
import type { Env } from '../src/env';
import { clearMemoryCache } from '../src/lib/cache';
import { resetMemoryStorage } from '../src/store';
import { bytesToBase64, decodeBase58, utf8 } from '../src/lib/encoding';
import { signJwt, verifyJwt } from '../src/lib/jwt';
import { parseKeypair } from '../src/lib/keys';
import { stablecoinUsd } from '../src/lib/pricing';
import { pushText } from '../src/push/messages';
import { SGT_GROUP, isSeekerGenesisMint, parseMainDomain } from '../src/seeker';
import { DYNAMIC_VARIABLES, SYSTEM_PROMPT } from '../src/voice/agent-config';
import { sessionVariables } from '../src/voice/session';
import { json, mockFetch, type FetchMock } from './helpers';

const app = createApp();
let fetchMock: FetchMock | undefined;
beforeEach(() => {
  clearMemoryCache();
  resetMemoryStorage();
});
afterEach(() => fetchMock?.restore());

const post = (path: string, body: unknown, env: Env, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', headers, body: JSON.stringify(body) }, env);

describe('encoding and keys', () => {
  it('round-trips base58', () => {
    const key = Keypair.generate();
    expect(decodeBase58(key.publicKey.toBase58())).toEqual(key.publicKey.toBytes());
    expect(decodeBase58(encodeBase58(Uint8Array.of(0, 0, 7)))).toEqual(Uint8Array.of(0, 0, 7));
    expect(() => decodeBase58('0OIl')).toThrow();
  });

  it('accepts a keypair as base58 or as a JSON byte array', () => {
    const key = Keypair.generate();
    const asJson = JSON.stringify(Array.from(key.secretKey));
    const asBase58 = encodeBase58(key.secretKey);
    expect(parseKeypair(asJson).publicKey.equals(key.publicKey)).toBe(true);
    expect(parseKeypair(asBase58).publicKey.equals(key.publicKey)).toBe(true);
    expect(() => parseKeypair('[1,2,3]')).toThrow();
  });

  it('never echoes a malformed key in the error', async () => {
    const env: Env = { CRANK_KEYPAIR: 'definitely-not-a-key-0OIl', DOJO_SECRET: 's3cret' };
    const response = await post(
      '/v1/dojo/memo',
      { runId: 'run-1', score: 640, historyHash: 'a'.repeat(64) },
      env,
      { authorization: 'Bearer s3cret' },
    );
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain('CRANK_KEYPAIR');
    expect(text).not.toContain('definitely-not-a-key');
  });
});

describe('tokens', () => {
  it('verifies its own tokens and rejects tampered, expired or foreign ones', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = await signJwt({ wallet: 'w', exp }, 'secret-a');
    expect(await verifyJwt(token, 'secret-a')).toMatchObject({ wallet: 'w' });
    expect(await verifyJwt(token, 'secret-b')).toBeNull();
    expect(await verifyJwt(`${token}x`, 'secret-a')).toBeNull();
    expect(await verifyJwt(token, 'secret-a', exp + 1)).toBeNull();
    const [head, , signature] = token.split('.');
    const forged = `${head}.${btoa(JSON.stringify({ wallet: 'attacker', exp }))}.${signature}`;
    expect(await verifyJwt(forged, 'secret-a')).toBeNull();
    expect(await verifyJwt('not.a.jwt', 'secret-a')).toBeNull();
  });
});

describe('wallet sign-in', () => {
  const env: Env = { SESSION_JWT_SECRET: 'session-secret', SUPABASE_JWT_SECRET: 'supabase-secret' };
  const wallet = Keypair.generate();
  const address = wallet.publicKey.toBase58();
  const sign = (message: string, key = wallet) =>
    ed25519.sign(utf8(message), key.secretKey.subarray(0, 32));

  async function challenge() {
    const response = await post('/v1/auth/challenge', { wallet: address }, env);
    expect(response.status).toBe(200);
    return (await response.json()) as { message: string; challenge: string; expiresAt: string };
  }

  it('mints a Supabase-compatible session for a valid signature', async () => {
    const issued = await challenge();
    expect(issued.message).toContain(address);
    expect(issued.message).toContain('does not move any funds');
    const response = await post(
      '/v1/auth/session',
      {
        wallet: address,
        challenge: issued.challenge,
        signature: encodeBase58(sign(issued.message)),
      },
      env,
    );
    expect(response.status).toBe(200);
    const session = (await response.json()) as { token: string; wallet: string; expiresAt: string };
    expect(session.wallet).toBe(address);
    const claims = await verifyJwt(session.token, 'supabase-secret');
    expect(Object.keys(claims!).sort()).toEqual(['exp', 'role', 'wallet']);
    expect(claims).toMatchObject({ role: 'authenticated', wallet: address });
  });

  it('accepts a base64 signature too', async () => {
    const issued = await challenge();
    const response = await post(
      '/v1/auth/session',
      {
        wallet: address,
        challenge: issued.challenge,
        signature: bytesToBase64(sign(issued.message)),
      },
      env,
    );
    expect(response.status).toBe(200);
  });

  it('refuses a challenge that was already used', async () => {
    const issued = await challenge();
    const body = {
      wallet: address,
      challenge: issued.challenge,
      signature: encodeBase58(sign(issued.message)),
    };
    expect((await post('/v1/auth/session', body, env)).status).toBe(200);
    expect((await post('/v1/auth/session', body, env)).status).toBe(401);
  });

  it('refuses a signature from another key or over another message', async () => {
    const issued = await challenge();
    const other = Keypair.generate();
    for (const signature of [sign(issued.message, other), sign(`${issued.message} `)]) {
      const response = await post(
        '/v1/auth/session',
        { wallet: address, challenge: issued.challenge, signature: encodeBase58(signature) },
        env,
      );
      expect(response.status).toBe(401);
    }
  });

  it('refuses a challenge issued for another wallet', async () => {
    const issued = await challenge();
    const other = Keypair.generate();
    const response = await post(
      '/v1/auth/session',
      {
        wallet: other.publicKey.toBase58(),
        challenge: issued.challenge,
        signature: encodeBase58(sign(issued.message, other)),
      },
      env,
    );
    expect(response.status).toBe(401);
  });

  it('checks signatures against the exact message', () => {
    const message = signInMessage(address, 'nonce', '2026-11-27T00:00:00.000Z');
    expect(verifyWalletSignature(address, message, encodeBase58(sign(message)))).toBe(true);
    expect(verifyWalletSignature(address, message, 'garbage')).toBe(false);
  });
});

describe('guarded endpoints', () => {
  it('needs a session for relay and extend calls', async () => {
    const env: Env = { SESSION_JWT_SECRET: 'session-secret' };
    const hold = Keypair.generate().publicKey.toBase58();
    for (const [path, body] of [
      ['/v1/relay/reclaim', { hold }],
      ['/v1/relay/withdraw', { mint: hold, amount: '5' }],
      ['/v1/relay/open', { recipient: hold, mint: hold, amount: '5', lang: 'en' }],
      ['/v1/voice/extend', { hold, hours: 2 }],
    ] as const) {
      const response = await post(path, body, env);
      expect(response.status, path).toBe(401);
      const withBadToken = await post(path, body, env, { authorization: 'Bearer nope' });
      expect(withBadToken.status, path).toBe(401);
    }
  });

  it('needs the shared secret for the crank and the dojo memo', async () => {
    const env: Env = { CRANK_SECRET: 'crank-secret', DOJO_SECRET: 'dojo-secret' };
    const memo = { runId: 'run-1', score: 1, historyHash: 'b'.repeat(64) };
    expect((await post('/v1/crank', {}, env)).status).toBe(401);
    expect((await post('/v1/crank', {}, env, { 'x-crank-secret': 'wrong' })).status).toBe(401);
    expect((await post('/v1/dojo/memo', memo, env)).status).toBe(401);
    expect((await post('/v1/dojo/memo', memo, env, { authorization: 'Bearer wrong' })).status).toBe(
      401,
    );
    expect((await post('/v1/crank', {}, {}, { 'x-crank-secret': 'x' })).status).toBe(503);
  });

  it('answers unknown routes and preflights properly', async () => {
    const missing = await app.request('/v1/nope', {}, {});
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: { code: 'not_found', message: 'No such route' },
    });

    const preflight = await app.request(
      '/v1/assess',
      {
        method: 'OPTIONS',
        headers: { origin: 'https://app.example', 'access-control-request-method': 'POST' },
      },
      {},
    );
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('reports a missing database as unavailable, not as a crash', async () => {
    const stats = await app.request('/v1/stats', {}, {});
    expect(stats.status).toBe(503);
    expect(((await stats.json()) as { error: { code: string } }).error.code).toBe('unavailable');
  });
});

describe('GET /v1/names/:name', () => {
  it('resolves a name, retrying with the new suffix when .sol is refused', async () => {
    const owner = Keypair.generate().publicKey.toBase58();
    fetchMock = mockFetch({
      'sdk-proxy-v2.sns.id': (url) =>
        url.pathname === '/resolve/alice.sns'
          ? json({ s: 'ok', result: owner })
          : json({ s: 'error', result: 'Unsupported TLD' }, 400),
    });
    const response = await app.request('/v1/names/alice.sol', {}, {});
    expect(await response.json()).toEqual({ name: 'alice.sol', address: owner, lookalikeOf: null });
  });

  it('flags a look-alike even when it does not resolve', async () => {
    fetchMock = mockFetch({
      'sdk-proxy-v2.sns.id': () => json({ s: 'error', result: 'Domain not found' }, 404),
    });
    const response = await app.request('/v1/names/b1nance', {}, {});
    expect(await response.json()).toEqual({
      name: 'b1nance.sol',
      address: null,
      lookalikeOf: 'binance.sol',
    });
  });

  it('says so when the name service is down', async () => {
    fetchMock = mockFetch({});
    const response = await app.request('/v1/names/alice.sol', {}, {});
    expect(response.status).toBe(502);
  });
});

describe('windows', () => {
  const limits = { defaultWindowSecs: 1800, maxWindowSecs: 259200 };

  it('never opens a relayed hold below the policy window or the program floor', () => {
    expect(relayWindowSecs(0, undefined, limits)).toBe(1800);
    expect(relayWindowSecs(1, 60, limits)).toBe(1800);
    expect(relayWindowSecs(21600, 600, limits)).toBe(21600);
    expect(relayWindowSecs(86400, undefined, limits)).toBe(86400);
  });

  it('lets the owner ask for longer, up to the maximum', () => {
    expect(relayWindowSecs(1800, 7200, limits)).toBe(7200);
    expect(relayWindowSecs(1800, 999_999, limits)).toBe(259200);
  });

  it('extends from creation time, never earlier than now set and never past the maximum', () => {
    const hold = { createdAt: 1_000_000, releaseAt: 1_000_000 + 1800 };
    expect(extendedReleaseAt(hold, Tier.SUSPICIOUS, 259200)).toBe(1_000_000 + 21600);
    expect(extendedReleaseAt(hold, Tier.FLAGGED, 259200)).toBe(1_000_000 + 86400);
    expect(extendedReleaseAt(hold, Tier.SANCTIONED, 259200)).toBe(1_000_000 + 259200);
    expect(extendedReleaseAt(hold, Tier.SANCTIONED, 100_000)).toBe(1_000_000 + 100_000);
    // A hold the sender already lengthened is not pulled back in.
    const long = { createdAt: 1_000_000, releaseAt: 1_000_000 + 200_000 };
    expect(extendedReleaseAt(long, Tier.FLAGGED, 259200)).toBe(long.releaseAt);
  });
});

describe('collector mappings', () => {
  it('maps on-chain counters to reputation signals', () => {
    const ids = (facts: Parameters<typeof reputationSignals>[0]) =>
      reputationSignals(facts).map((signal) => signal.signal);
    const base = {
      trusted: false,
      flags: 0,
      holdsReceived: 0,
      holdsReclaimedAgainst: 0,
      holdsReleasedTo: 0,
      offchainFlags: 0,
    };
    expect(ids(base)).toEqual(['no_onchain_flags', 'no_offchain_flags']);
    expect(ids({ ...base, trusted: true, offchainFlags: null })).toEqual([
      'trust_account',
      'no_onchain_flags',
    ]);
    expect(ids({ ...base, flags: 2, holdsReceived: 4, holdsReclaimedAgainst: 2 })).toEqual([
      'onchain_flags',
      'reclaimed_majority',
      'no_offchain_flags',
    ]);
    expect(ids({ ...base, holdsReceived: 4, holdsReclaimedAgainst: 1 })).toContain(
      'reclaimed_often',
    );
    // Too few holds for a ratio to mean anything.
    expect(ids({ ...base, holdsReceived: 2, holdsReclaimedAgainst: 2 })).not.toContain(
      'reclaimed_majority',
    );
    expect(ids({ ...base, holdsReceived: 6, holdsReleasedTo: 6 })).toContain('clean_releases');
  });

  it('maps Chainabuse answers to confirmed, unconfirmed or none', () => {
    const address = 'Addr';
    const none = summarise({ reports: [], count: 0 });
    expect(reportSignals(none, address)[0]!.signal).toBe('no_reports');
    const one = summarise({ reports: [{ id: '1', trusted: false }], count: 1 });
    expect(reportSignals(one, address)[0]).toMatchObject({
      signal: 'unconfirmed_reports',
      value: 1,
    });
    const vetted = summarise({ reports: [{ id: '1', checked: true }], count: 1 });
    expect(reportSignals(vetted, address)[0]!.signal).toBe('confirmed_reports');
    const many = summarise({ reports: [{ id: '1' }, { id: '2' }, { id: '3' }], count: 3 });
    expect(reportSignals(many, address)[0]!.signal).toBe('confirmed_reports');
    expect(summarise('garbage')).toMatchObject({ count: 0, vetted: 0 });
  });

  it('builds the sender baseline from history', () => {
    const at = (hour: number) => `2026-11-20T${String(hour).padStart(2, '0')}:00:00Z`;
    const history: PaymentHistory = {
      holds: [
        ...Array.from({ length: 4 }, () => ({
          recipient: 'Friend',
          mint: 'USDC',
          amount: '10000000',
          status: 1,
          created_at: at(10),
        })),
        { recipient: 'Shop', mint: 'USDC', amount: '30000000', status: 1, created_at: at(11) },
        { recipient: 'Scammer', mint: 'USDC', amount: '900000000', status: 2, created_at: at(3) },
      ],
      instants: [],
    };
    const friend = buildBaseline(history, 'Friend', 'USDC');
    expect(friend).toMatchObject({
      medianAmount: 10000000n,
      paymentsInToken: 5,
      releasedToRecipient: 4,
      reclaimedFromRecipient: 0,
    });
    const ids = (recipient: string, amount: bigint) =>
      baselineSignals(buildBaseline(history, recipient, 'USDC'), amount, new Date(at(10))).map(
        (signal) => signal.signal,
      );
    expect(ids('Friend', 10000000n)).toEqual(['released_to_recipient']);
    expect(ids('New', 49999999n)).toEqual(['first_payment_to_recipient']);
    expect(ids('New', 50000000n)).toEqual(['first_payment_to_recipient', 'amount_above_typical']);
    expect(ids('New', 200000000n)).toEqual([
      'first_payment_to_recipient',
      'amount_far_above_typical',
    ]);
    expect(ids('Scammer', 10000000n)).toEqual(['prior_reclaim_from_recipient']);
  });

  it('values USDC at par, exactly, and nothing else', () => {
    const usdc = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
    expect(stablecoinUsd(usdc, 12_345_678n)).toBe('12.35');
    expect(stablecoinUsd(usdc, 18_446_744_073_709_551_615n)).toBe('18446744073709.55');
    expect(stablecoinUsd(null, 1_000_000_000n)).toBeNull();
    expect(stablecoinUsd('SomeOtherMint', 5n)).toBeNull();
  });
});

describe('push copy', () => {
  const recipient = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

  it('ends with "Tap to undo" while the payment can be undone', () => {
    for (const kind of ['hold_placed', 'risk_rose', 'pre_release'] as const) {
      expect(pushText(kind, 'en', recipient, 1800).body.endsWith('Tap to undo')).toBe(true);
    }
    expect(pushText('hold_placed', 'es', recipient, 1800).body.endsWith('Toca para deshacer')).toBe(
      true,
    );
    expect(
      pushText('hold_placed', 'pt', recipient, 1800).body.endsWith('Toque para desfazer'),
    ).toBe(true);
    expect(pushText('hold_placed', 'hi', recipient, 1800).body.endsWith('टैप करें')).toBe(true);
  });

  it('does not offer undo once the hold is settled', () => {
    expect(pushText('released', 'en', recipient, 0).body).not.toContain('undo');
    expect(pushText('reclaimed', 'en', recipient, 0).body).not.toContain('Tap to undo');
  });

  it('names the recipient briefly and the time in words', () => {
    const text = pushText('hold_placed', 'en', recipient, 21600);
    expect(text.body).toContain('7xKX…gAsU');
    expect(text.body).toContain('6 hours');
    expect(text.body).not.toContain(recipient);
  });
});

describe('voice session', () => {
  it('supplies every variable the agent prompt refers to', () => {
    const referenced = [...SYSTEM_PROMPT.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
    for (const name of referenced) expect(DYNAMIC_VARIABLES, name).toContain(name);
    const variables = sessionVariables(
      {
        pda: 'Hold',
        sender: 'Sender',
        recipient: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        mint: null,
        amount: '5',
        tier: 3,
        origin: 0,
        status: 0,
        created_at: '2026-11-27T00:00:00Z',
        release_at: '2026-11-28T00:00:00Z',
        settled_at: null,
        evidence_hash: 'x',
        create_signature: null,
        settle_signature: null,
        amount_usd: null,
      },
      null,
      null,
      'hi',
      new Date('2026-11-27T18:00:00Z'),
    );
    expect(Object.keys(variables).sort()).toEqual([...DYNAMIC_VARIABLES].sort());
    expect(variables).toMatchObject({
      tier: 'FLAGGED',
      status: 'PENDING',
      can_undo: true,
      time_left: '6 घंटे',
    });
  });

  it('states the guardrails in the prompt', () => {
    expect(SYSTEM_PROMPT).toContain('Never tell the user to send money');
    expect(SYSTEM_PROMPT).toContain('seed phrase');
    expect(SYSTEM_PROMPT).toContain('AnyDesk');
    expect(SYSTEM_PROMPT).toContain('no warning signs were found');
  });
});

describe('Seeker Genesis Token check', () => {
  /** A Token-2022 mint with the given TLV extensions. */
  function mintWith(extensions: [number, Uint8Array][]): Uint8Array {
    const body = extensions.flatMap(([type, value]) => [
      type & 0xff,
      type >> 8,
      value.length & 0xff,
      value.length >> 8,
      ...value,
    ]);
    const data = new Uint8Array(166 + body.length);
    data[165] = 1;
    data.set(body, 166);
    return data;
  }
  const other = Keypair.generate().publicKey;
  const pair = (first: PublicKey, second: PublicKey, extra = 0) =>
    Uint8Array.from([...first.toBytes(), ...second.toBytes(), ...new Uint8Array(extra)]);

  it('accepts a mint whose metadata pointer and group are the Seeker group', () => {
    const data = mintWith([
      [18, pair(other, SGT_GROUP)],
      [23, pair(other, SGT_GROUP, 8)],
    ]);
    expect(isSeekerGenesisMint(data)).toBe(true);
  });

  it('rejects other groups, missing extensions and non-mints', () => {
    expect(
      isSeekerGenesisMint(
        mintWith([
          [18, pair(other, SGT_GROUP)],
          [23, pair(other, other, 8)],
        ]),
      ),
    ).toBe(false);
    expect(
      isSeekerGenesisMint(
        mintWith([
          [18, pair(other, other)],
          [23, pair(other, SGT_GROUP, 8)],
        ]),
      ),
    ).toBe(false);
    expect(isSeekerGenesisMint(mintWith([[23, pair(other, SGT_GROUP, 8)]]))).toBe(false);
    expect(isSeekerGenesisMint(mintWith([]))).toBe(false);
    expect(isSeekerGenesisMint(new Uint8Array(82))).toBe(false);
    const tokenAccount = mintWith([
      [18, pair(other, SGT_GROUP)],
      [23, pair(other, SGT_GROUP, 8)],
    ]);
    tokenAccount[165] = 2;
    expect(isSeekerGenesisMint(tokenAccount)).toBe(false);
  });

  it('parses a main-domain record', () => {
    const nameAccount = Keypair.generate().publicKey;
    const text = (value: string) => {
      const bytes = utf8(value);
      return [bytes.length, 0, 0, 0, ...bytes];
    };
    const data = Uint8Array.from([
      ...new Uint8Array(8),
      ...nameAccount.toBytes(),
      ...text('.skr'),
      ...text('prashant'),
    ]);
    const parsed = parseMainDomain(data)!;
    expect(parsed.nameAccount.equals(nameAccount)).toBe(true);
    expect(parsed).toMatchObject({ tld: '.skr', domain: 'prashant' });
    expect(parseMainDomain(data.subarray(0, 45))).toBeNull();
  });
});
