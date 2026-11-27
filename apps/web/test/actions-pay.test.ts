import { DEVNET_USDC_MINT, GuardianError, Tier, hashEvidence, toHex } from '@holdback/sdk';
import type { ActionGetResponse, TransactionResponse } from '@solana/actions-spec';
import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import { handlePayGet, handlePayPost, type PayActionDeps } from '@/lib/actions/pay';
import { ACTIONS_JSON } from '@/lib/actions/rules';
import { ACTION_VERSION, actionPreflight } from '@/lib/actions/spec';
import { CHAIN_IDS } from '@/lib/cluster';

import { decodePayment, fakeChain, mintAccount } from './helpers/chain';
import { evidenceDocument, fakeGuardian } from './helpers/guardian';

const ORIGIN = 'https://holdback.test';
const payer = Keypair.generate().publicKey;
const recipient = Keypair.generate().publicKey;
const USDC = DEVNET_USDC_MINT.toBase58();

function setup(tier: Tier = Tier.UNKNOWN, windowSecs?: number) {
  const chain = fakeChain();
  chain.accounts.set(USDC, mintAccount(6));
  const guardian = fakeGuardian(tier, windowSecs);
  const deps: PayActionDeps = { guardian, connection: chain.connection, cluster: 'devnet' };
  return { chain, guardian, deps };
}

const get = (query: string, deps: PayActionDeps) =>
  handlePayGet(new Request(`${ORIGIN}/api/actions/pay${query}`), deps);

const post = (query: string, body: unknown, deps: PayActionDeps) =>
  handlePayPost(
    new Request(`${ORIGIN}/api/actions/pay${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    deps,
  );

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { message: string }).message;
}

function expectActionHeaders(response: Response) {
  expect(response.headers.get('access-control-allow-origin')).toBe('*');
  expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  expect(response.headers.get('access-control-expose-headers')).toContain('X-Action-Version');
  expect(response.headers.get('x-action-version')).toBe(ACTION_VERSION);
  expect(response.headers.get('x-blockchain-ids')).toBe(CHAIN_IDS.devnet);
  expect(response.headers.get('content-type')).toBe('application/json');
}

describe('GET /api/actions/pay', () => {
  it('describes a fixed-amount payment with the current verdict', async () => {
    const { deps, guardian } = setup(Tier.SUSPICIOUS);
    const response = await get(`?to=${recipient.toBase58()}&amount=12.5&mint=USDC`, deps);
    expect(response.status).toBe(200);
    expectActionHeaders(response);

    const action = (await response.json()) as ActionGetResponse;
    expect(action.type).toBe('action');
    expect(action.icon).toBe(`${ORIGIN}/action-icon.svg`);
    expect(action.label).toBe('Pay 12.5 USDC');
    expect(action.title).toContain(recipient.toBase58().slice(0, 4));
    expect(action.description).toContain('SUSPICIOUS');
    expect(action.description).toContain('6 hours');
    expect(action.description).toContain('Fixture explanation.');
    expect(action.disabled).toBeUndefined();
    expect(action.links).toBeUndefined();

    // The verdict is requested for the exact amount, in base units, with no payer.
    expect(guardian.requests).toHaveLength(1);
    expect(guardian.requests[0]).toMatchObject({
      sender: '11111111111111111111111111111111',
      recipient: recipient.toBase58(),
      mint: USDC,
      amount: '12500000',
      lang: 'en',
    });
  });

  it('asks for the amount when the link has none', async () => {
    const { deps } = setup();
    const response = await get(`?to=${recipient.toBase58()}`, deps);
    const action = (await response.json()) as ActionGetResponse;

    expect(action.label).toBe('Pay with HOLDBACK');
    expect(action.description).toContain('UNKNOWN');
    expect(action.description).toContain('30 minutes');
    const [linked] = action.links?.actions ?? [];
    expect(linked?.type).toBe('transaction');
    expect(linked?.href).toBe(`/api/actions/pay?to=${recipient.toBase58()}&amount={amount}`);
    expect(linked?.parameters).toEqual([
      expect.objectContaining({ name: 'amount', type: 'number', required: true }),
    ]);
    expect(linked?.parameters?.[0]?.label).toBe('Amount in SOL');
  });

  it('keeps the mint and the language in the amount link', async () => {
    const { deps } = setup();
    const response = await get(`?to=${recipient.toBase58()}&mint=${USDC}&lang=hi`, deps);
    const action = (await response.json()) as ActionGetResponse;
    expect(action.links?.actions[0]?.href).toBe(
      `/api/actions/pay?to=${recipient.toBase58()}&mint=${USDC}&lang=hi&amount={amount}`,
    );
  });

  it('disables the action for a sanctioned recipient', async () => {
    const { deps } = setup(Tier.SANCTIONED);
    const response = await get(`?to=${recipient.toBase58()}&amount=1`, deps);
    expect(response.status).toBe(200);
    const action = (await response.json()) as ActionGetResponse;
    expect(action.disabled).toBe(true);
    expect(action.error?.message).toMatch(/sanctions list/);
    expect(action.description).toContain('SANCTIONED');
  });

  it('still answers when the agent is down or not configured', async () => {
    const { deps } = setup();
    const down: PayActionDeps = {
      ...deps,
      guardian: {
        assess: async () => {
          throw new GuardianError(503, 'unavailable', 'down');
        },
      },
    };
    for (const variant of [down, { ...deps, guardian: null }]) {
      const response = await get(`?to=${recipient.toBase58()}&amount=1`, variant);
      expect(response.status).toBe(200);
      const action = (await response.json()) as ActionGetResponse;
      expect(action.description).toMatch(/not available right now/);
      expect(action.disabled).toBeUndefined();
    }
  });

  it.each([
    ['', /Missing "to"/],
    ['?to=not-an-address', /"to" is not a valid Solana address/],
    [`?to=${recipient.toBase58()}&amount=abc`, /"amount" must be a positive number/],
    [`?to=${recipient.toBase58()}&amount=-1`, /"amount" must be a positive number/],
    [`?to=${recipient.toBase58()}&amount=0`, /greater than zero/],
    [`?to=${recipient.toBase58()}&amount=0.0000000001`, /at most 9 decimal places/],
    [`?to=${recipient.toBase58()}&amount=1.1234567&mint=USDC`, /at most 6 decimal places/],
    [`?to=${recipient.toBase58()}&amount=99999999999999999999`, /too large/],
    [`?to=${recipient.toBase58()}&mint=nope`, /"mint" is not a valid Solana address/],
    [`?to=${recipient.toBase58()}&lang=fr`, /"lang" must be one of en, hi, es, pt/],
  ])('rejects %s', async (query, message) => {
    const { deps, guardian } = setup();
    const response = await get(query, deps);
    expect(response.status).toBe(400);
    expectActionHeaders(response);
    expect(await errorOf(response)).toMatch(message);
    expect(guardian.requests).toHaveLength(0);
  });

  it('rejects a mint that does not exist on the cluster', async () => {
    const { deps } = setup();
    const unknown = Keypair.generate().publicKey.toBase58();
    const response = await get(`?to=${recipient.toBase58()}&mint=${unknown}`, deps);
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatch(/does not exist/);
  });

  it('rejects the USDC shortcut outside devnet', async () => {
    const { deps } = setup();
    const response = await get(`?to=${recipient.toBase58()}&mint=USDC`, {
      ...deps,
      cluster: 'mainnet-beta',
    });
    expect(response.status).toBe(400);
    expect(response.headers.get('x-blockchain-ids')).toBe(CHAIN_IDS['mainnet-beta']);
  });
});

describe('POST /api/actions/pay', () => {
  const body = { account: payer.toBase58() };

  it('builds a token hold sized by the agent', async () => {
    const { deps, guardian } = setup(Tier.FLAGGED);
    const response = await post(`?to=${recipient.toBase58()}&amount=12.5&mint=USDC`, body, deps);
    expect(response.status).toBe(200);
    expectActionHeaders(response);

    const result = (await response.json()) as TransactionResponse;
    expect(result.type).toBe('transaction');
    expect(result.message).toContain('1 day');

    const request = guardian.requests[0]!;
    expect(request.sender).toBe(payer.toBase58());
    const payment = decodePayment(result.transaction);
    expect(payment.name).toBe('create_hold');
    expect(payment.feePayer).toBe(payer.toBase58());
    expect(payment.accounts[0]).toBe(payer.toBase58());
    expect(payment.accounts[1]).toBe(recipient.toBase58());
    expect(payment.accounts).toContain(USDC);
    expect(payment.amount).toBe(12_500_000n);
    expect(payment.windowSecs).toBe(86_400);
    expect(payment.tier).toBe(Tier.FLAGGED);
    // The hash written on-chain is the hash of the document the agent stored.
    expect(payment.evidenceHash).toBe(toHex(hashEvidence(evidenceDocument(request, Tier.FLAGGED))));
  });

  it('builds a SOL hold when no mint is given', async () => {
    const { deps } = setup(Tier.UNKNOWN);
    const response = await post(`?to=${recipient.toBase58()}&amount=0.25`, body, deps);
    const result = (await response.json()) as TransactionResponse;

    const payment = decodePayment(result.transaction);
    expect(payment.name).toBe('create_hold_sol');
    expect(payment.accounts.slice(0, 2)).toEqual([payer.toBase58(), recipient.toBase58()]);
    expect(payment.amount).toBe(250_000_000n);
    expect(payment.windowSecs).toBe(1_800);
    expect(payment.tier).toBe(Tier.UNKNOWN);
    expect(result.message).toContain('30 minutes');
  });

  it('uses the instant path when the payer trusts the recipient on-chain', async () => {
    const { deps, chain } = setup(Tier.TRUSTED);
    chain.setTrust(payer, recipient);

    const token = await post(`?to=${recipient.toBase58()}&amount=3&mint=USDC`, body, deps);
    const tokenResult = (await token.json()) as TransactionResponse;
    const tokenPayment = decodePayment(tokenResult.transaction);
    expect(tokenPayment.name).toBe('instant_transfer');
    expect(tokenPayment.amount).toBe(3_000_000n);
    expect(tokenResult.message).toMatch(/instantly/);

    const sol = await post(`?to=${recipient.toBase58()}&amount=1`, body, deps);
    const solPayment = decodePayment(((await sol.json()) as TransactionResponse).transaction);
    expect(solPayment.name).toBe('instant_transfer_sol');
    expect(solPayment.amount).toBe(1_000_000_000n);
  });

  it('never goes instant without the on-chain trust account', async () => {
    const { deps, chain } = setup(Tier.TRUSTED);

    // No Trust account: a hold with the standard window, whatever the agent thinks.
    const first = await post(`?to=${recipient.toBase58()}&amount=1`, body, deps);
    const fallback = decodePayment(((await first.json()) as TransactionResponse).transaction);
    expect(fallback.name).toBe('create_hold_sol');
    expect(fallback.windowSecs).toBe(1_800);
    expect(fallback.tier).toBe(Tier.TRUSTED);

    // A program minimum below the standard window changes nothing ...
    chain.setConfig(0);
    const second = await post(`?to=${recipient.toBase58()}&amount=1`, body, deps);
    const unchanged = (await second.json()) as TransactionResponse;
    expect(decodePayment(unchanged.transaction).windowSecs).toBe(1_800);
    expect(unchanged.message).toContain('30 minutes');

    // ... and one above it is respected, so the program never rejects the hold.
    chain.setConfig(3_600);
    const third = await post(`?to=${recipient.toBase58()}&amount=1`, body, deps);
    expect(
      decodePayment(((await third.json()) as TransactionResponse).transaction).windowSecs,
    ).toBe(3_600);
  });

  it('refuses a sanctioned recipient', async () => {
    const { deps } = setup(Tier.SANCTIONED);
    const response = await post(`?to=${recipient.toBase58()}&amount=1`, body, deps);
    expect(response.status).toBe(403);
    expectActionHeaders(response);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.message).toMatch(/sanctions list/);
    expect(payload.transaction).toBeUndefined();
  });

  it.each([
    ['a missing amount', `?to=${recipient.toBase58()}`, body, /Missing "amount"/],
    ['a missing account', `?to=${recipient.toBase58()}&amount=1`, {}, /Missing "account"/],
    [
      'an invalid account',
      `?to=${recipient.toBase58()}&amount=1`,
      { account: 'xyz' },
      /"account" is not a valid Solana address/,
    ],
    ['a body that is not JSON', `?to=${recipient.toBase58()}&amount=1`, 'not json', /must be JSON/],
    ['paying yourself', `?to=${payer.toBase58()}&amount=1`, body, /same address/],
  ])('rejects %s', async (_name, query, payload, message) => {
    const { deps, guardian } = setup();
    const response = await post(query, payload, deps);
    expect(response.status).toBe(400);
    expectActionHeaders(response);
    expect(await errorOf(response)).toMatch(message);
    expect(guardian.requests).toHaveLength(0);
  });

  it('fails with 503 and no transaction when the agent cannot size the payment', async () => {
    const { deps } = setup();
    const response = await post(`?to=${recipient.toBase58()}&amount=1`, body, {
      ...deps,
      guardian: null,
    });
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toMatch(/not available/);
  });

  it('passes on a rejection from the agent as a 400', async () => {
    const { deps } = setup();
    const response = await post(`?to=${recipient.toBase58()}&amount=1`, body, {
      ...deps,
      guardian: {
        assess: async () => {
          throw new GuardianError(422, 'bad_request', 'amount below minimum');
        },
      },
    });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatch(/amount below minimum/);
  });

  it('fails with 502 when the RPC does not answer', async () => {
    const { guardian } = setup();
    const response = await post(`?to=${recipient.toBase58()}&amount=1`, body, {
      guardian,
      connection: fakeChain({ failing: true }).connection,
      cluster: 'devnet',
    });
    expect(response.status).toBe(502);
    expect(await errorOf(response)).toMatch(/RPC/);
  });
});

describe('Action plumbing', () => {
  it('answers the CORS preflight with the Action headers and no body', async () => {
    const response = actionPreflight('devnet');
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-headers')).toContain('Content-Type');
    expect(response.headers.get('x-action-version')).toBe(ACTION_VERSION);
    expect(await response.text()).toBe('');
  });

  it('maps the shareable link and the API path in actions.json', () => {
    expect(ACTIONS_JSON.rules).toEqual([
      { pathPattern: '/pay', apiPath: '/api/actions/pay' },
      { pathPattern: '/api/actions/**', apiPath: '/api/actions/**' },
    ]);
  });
});
