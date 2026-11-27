import type { RelayOpenRequest } from '@holdback/sdk';
import { describe, expect, it } from 'vitest';

import {
  PollarFlow,
  PollarFlowError,
  toTransferResult,
  type PollarActivity,
  type PollarSession,
  type TransferRequest,
  type TransferResult,
} from '@/lib/pollarFlow';

const OWNER = 'Owner1111111111111111111111111111111111111';
const MINT = 'Mint11111111111111111111111111111111111111';
const BOX = 'Box111111111111111111111111111111111111111';
const BOX_TOKEN = 'BoxToken1111111111111111111111111111111111';
const NOW = Date.parse('2026-11-27T12:00:00Z');

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

/** A scripted stand-in for the agent and the Pollar client, recording every call. */
function setup(
  options: {
    transfers?: (TransferResult | Error)[];
    balances?: (bigint | null)[];
    completeErrors?: Error[];
    openError?: Error;
    initial?: PollarSession | null;
  } = {},
) {
  const calls: string[] = [];
  const transfers: TransferRequest[] = [];
  const opened: RelayOpenRequest[] = [];
  const tokens: (string | null)[] = [];
  const persisted: (PollarSession | null)[] = [];
  const activities: PollarActivity[] = [];
  const transferScript = [...(options.transfers ?? [])];
  const balanceScript = [...(options.balances ?? [])];
  const completeErrors = [...(options.completeErrors ?? [])];
  let lastBalance: bigint | null = 0n;

  const flow = new PollarFlow(
    {
      api: {
        relayAuthStart: async (owner, mint) => {
          calls.push('authStart');
          return {
            challengeId: 'challenge-1',
            secret: 'secret-1',
            amount: '12345',
            mint,
            depositBox: BOX,
            boxTokenAccount: BOX_TOKEN,
            expiresAt: new Date(NOW + 900_000).toISOString(),
            owner,
          };
        },
        relayAuthComplete: async (body) => {
          calls.push(`authComplete:${body.signature}`);
          const failure = completeErrors.shift();
          if (failure) throw failure;
          return {
            token: 'relay-token',
            owner: OWNER,
            expiresAt: new Date(NOW + 3_600_000).toISOString(),
          };
        },
        relayOpen: async (body) => {
          calls.push('open');
          opened.push(body);
          if (options.openError) throw options.openError;
          return { hold: 'Hold111', signature: 'open-sig', assessment: {} as never };
        },
        relayReclaim: async (hold) => {
          calls.push(`reclaim:${hold}`);
          return { signature: 'reclaim-sig' };
        },
        relayWithdraw: async (mint, amount) => {
          calls.push(`withdraw:${mint}:${amount}`);
          return { signature: 'withdraw-sig' };
        },
      },
      transfer: async (request) => {
        transfers.push(request);
        const next = transferScript.shift() ?? {
          status: 'sent',
          hash: `sig-${transfers.length}`,
          settled: true,
        };
        if (next instanceof Error) throw next;
        return next;
      },
      setToken: (token) => tokens.push(token),
      boxBalance: async () => {
        if (balanceScript.length > 0) lastBalance = balanceScript.shift()!;
        return lastBalance;
      },
      persist: (session) => {
        persisted.push(session);
      },
      now: () => NOW,
      sleep: async () => undefined,
    },
    options.initial ?? null,
  );
  flow.subscribe((state) => activities.push(state.activity));
  return { flow, calls, transfers, opened, tokens, persisted, activities };
}

const session = (overrides: Partial<PollarSession> = {}): PollarSession => ({
  token: 'relay-token',
  owner: OWNER,
  expiresAt: new Date(NOW + 3_600_000).toISOString(),
  mint: MINT,
  depositBox: BOX,
  boxTokenAccount: BOX_TOKEN,
  ...overrides,
});

async function failure(promise: Promise<unknown>): Promise<PollarFlowError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PollarFlowError) return error;
    throw error;
  }
  throw new Error('expected the flow to fail');
}

describe('proof-by-transfer login', () => {
  it('runs challenge, transfer, verify and stores the session', async () => {
    const { flow, calls, transfers, tokens, persisted, activities } = setup();
    const granted = await flow.authenticate(OWNER, MINT);

    expect(calls).toEqual(['authStart', 'authComplete:sig-1']);
    expect(transfers).toEqual([{ destination: BOX, amount: '12345', mint: MINT }]);
    expect(granted).toEqual(session());
    expect(flow.getState()).toEqual({ session: session(), activity: 'idle', error: null });
    expect(tokens).toEqual(['relay-token']);
    expect(persisted).toEqual([session()]);
    expect(activities).toEqual([
      'auth_challenge',
      'auth_transfer',
      'auth_verify',
      'auth_verify',
      'idle',
    ]);
  });

  it('retries with the box token account when Pollar refuses the box address', async () => {
    const { flow, transfers, calls } = setup({
      transfers: [
        { status: 'rejected', message: 'destination is off curve' },
        { status: 'sent', hash: 'sig-token', settled: false },
      ],
    });
    await flow.authenticate(OWNER, MINT);
    expect(transfers.map((request) => request.destination)).toEqual([BOX, BOX_TOKEN]);
    expect(calls).toContain('authComplete:sig-token');
  });

  it('fails clearly, with both reasons, when both destinations are refused', async () => {
    const { flow, calls, tokens } = setup({
      transfers: [
        { status: 'rejected', message: 'off curve' },
        { status: 'rejected', message: 'unknown token account' },
      ],
    });
    const error = await failure(flow.authenticate(OWNER, MINT));
    expect(error.code).toBe('deposit_rejected');
    expect(error.message).toContain('off curve');
    expect(error.message).toContain('unknown token account');
    expect(calls).toEqual(['authStart']);
    expect(tokens).toEqual([]);
    expect(flow.getState()).toMatchObject({ session: null, activity: 'idle', error });
  });

  it('does not try the second address when the transfer call itself throws', async () => {
    const { flow, transfers } = setup({ transfers: [new Error('network down')] });
    const error = await failure(flow.authenticate(OWNER, MINT));
    expect(error.code).toBe('transfer_failed');
    expect(transfers).toHaveLength(1);
  });

  it('stops for an approval on another device', async () => {
    const { flow, transfers } = setup({ transfers: [{ status: 'needs_approval' }] });
    expect((await failure(flow.authenticate(OWNER, MINT))).code).toBe('needs_approval');
    expect(transfers).toHaveLength(1);
  });

  it('waits for the cluster to see the proof transfer', async () => {
    const { flow, calls } = setup({
      completeErrors: [
        new HttpError(403, 'transaction_not_found'),
        new HttpError(403, 'transaction_not_found'),
      ],
    });
    await flow.authenticate(OWNER, MINT);
    expect(calls.filter((call) => call.startsWith('authComplete'))).toHaveLength(3);
  });

  it('gives up at once when the agent rejects the proof, keeping the transfer signature', async () => {
    const { flow, calls } = setup({ completeErrors: [new HttpError(403, 'no_matching_transfer')] });
    const error = await failure(flow.authenticate(OWNER, MINT));
    expect(error.code).toBe('agent_error');
    expect(error.transferHash).toBe('sig-1');
    expect(calls.filter((call) => call.startsWith('authComplete'))).toHaveLength(1);
  });
});

describe('paying through the deposit box', () => {
  it('refuses to pay before ownership is proven', async () => {
    const { flow, transfers } = setup();
    const error = await failure(flow.send({ recipient: 'R', amount: 5_000_000n, lang: 'en' }));
    expect(error.code).toBe('not_authenticated');
    expect(transfers).toEqual([]);
  });

  it('deposits the amount, waits for it, then asks the relayer to open the hold', async () => {
    const { flow, transfers, opened, activities } = setup({
      initial: session(),
      balances: [0n, 0n, 5_000_000n],
    });
    const result = await flow.send({
      recipient: 'Recipient',
      amount: 5_000_000n,
      context: 'rent',
      lang: 'hi',
      windowSecs: 86_400,
    });

    expect(result.hold).toBe('Hold111');
    expect(transfers).toEqual([{ destination: BOX, amount: '5000000', mint: MINT }]);
    expect(opened).toEqual([
      {
        recipient: 'Recipient',
        mint: MINT,
        amount: '5000000',
        context: 'rent',
        lang: 'hi',
        windowSecs: 86_400,
      },
    ]);
    expect(activities).toEqual(['deposit', 'awaiting_funds', 'opening', 'idle']);
  });

  it('only deposits what the box is missing', async () => {
    const { flow, transfers } = setup({ initial: session(), balances: [12_345n, 5_000_000n] });
    await flow.send({ recipient: 'R', amount: 5_000_000n, lang: 'en' });
    expect(transfers[0]?.amount).toBe('4987655');
  });

  it('skips the deposit when the box already holds enough (retry after a failed open)', async () => {
    const { flow, transfers, calls } = setup({ initial: session(), balances: [5_000_000n] });
    await flow.send({ recipient: 'R', amount: 5_000_000n, lang: 'en' });
    expect(transfers).toEqual([]);
    expect(calls).toEqual(['open']);
  });

  it('deposits the full amount when the box balance cannot be read', async () => {
    const { flow, transfers } = setup({ initial: session(), balances: [null, 5_000_000n] });
    await flow.send({ recipient: 'R', amount: 5_000_000n, lang: 'en' });
    expect(transfers[0]?.amount).toBe('5000000');
  });

  it('retries the deposit against the box token account', async () => {
    const { flow, transfers } = setup({
      initial: session(),
      balances: [0n, 5_000_000n],
      transfers: [{ status: 'rejected', message: 'bad address' }],
    });
    await flow.send({ recipient: 'R', amount: 5_000_000n, lang: 'en' });
    expect(transfers.map((request) => request.destination)).toEqual([BOX, BOX_TOKEN]);
  });

  it('reports a deposit that never arrives without opening a hold', async () => {
    const { flow, calls } = setup({ initial: session(), balances: [0n] });
    const error = await failure(flow.send({ recipient: 'R', amount: 5_000_000n, lang: 'en' }));
    expect(error.code).toBe('funds_not_arrived');
    expect(error.transferHash).toBe('sig-1');
    expect(calls).not.toContain('open');
  });

  it('keeps the session and the transfer signature when the relayer fails to open', async () => {
    const { flow } = setup({
      initial: session(),
      balances: [0n, 5_000_000n],
      openError: new HttpError(502, 'rpc_error'),
    });
    const error = await failure(flow.send({ recipient: 'R', amount: 5_000_000n, lang: 'en' }));
    expect(error.code).toBe('agent_error');
    expect(error.transferHash).toBe('sig-1');
    expect(flow.getState().session).toEqual(session());
  });

  it('drops the session when the agent says it is no longer valid', async () => {
    const { flow, tokens, persisted } = setup({
      initial: session(),
      balances: [5_000_000n],
      openError: new HttpError(401, 'unauthorized'),
    });
    const error = await failure(flow.send({ recipient: 'R', amount: 5_000_000n, lang: 'en' }));
    expect(error.code).toBe('session_expired');
    expect(flow.getState().session).toBeNull();
    expect(tokens).toEqual(['relay-token', null]);
    expect(persisted).toEqual([null]);
  });
});

describe('undo, withdraw and session handling', () => {
  it('undoes and withdraws through the relayer', async () => {
    const { flow, calls } = setup({ initial: session() });
    expect(await flow.undo('Hold111')).toEqual({ signature: 'reclaim-sig' });
    expect(await flow.withdraw(250_000n)).toEqual({ signature: 'withdraw-sig' });
    expect(calls).toEqual(['reclaim:Hold111', `withdraw:${MINT}:250000`]);
  });

  it('ignores a stored session that has expired', () => {
    const { flow, tokens } = setup({
      initial: session({ expiresAt: new Date(NOW - 1).toISOString() }),
    });
    expect(flow.getState().session).toBeNull();
    expect(tokens).toEqual([]);
  });

  it('adopts a restored session only while it is valid', () => {
    const { flow, tokens } = setup();
    expect(flow.restore(session({ expiresAt: 'garbage' }))).toBe(false);
    expect(flow.restore(session())).toBe(true);
    expect(flow.getState().session).toEqual(session());
    expect(tokens).toEqual(['relay-token']);
  });

  it('runs one operation at a time', async () => {
    const { flow } = setup({ initial: session() });
    const first = flow.undo('Hold111');
    const error = await failure(flow.undo('Hold222'));
    expect(error.code).toBe('busy');
    await first;
    expect(flow.getState().activity).toBe('idle');
  });

  it('forgets everything on sign-out', async () => {
    const { flow, tokens, persisted } = setup({ initial: session() });
    await flow.signOut();
    expect(flow.getState()).toEqual({ session: null, activity: 'idle', error: null });
    expect(tokens.at(-1)).toBeNull();
    expect(persisted).toEqual([null]);
  });
});

describe('toTransferResult', () => {
  it('maps every Pollar outcome', () => {
    expect(toTransferResult({ status: 'success', hash: 'a' })).toEqual({
      status: 'sent',
      hash: 'a',
      settled: true,
    });
    expect(toTransferResult({ status: 'pending', hash: 'b' })).toEqual({
      status: 'sent',
      hash: 'b',
      settled: false,
    });
    expect(toTransferResult({ status: 'cosign_pending' })).toEqual({ status: 'needs_approval' });
    expect(toTransferResult({ status: 'error', details: 'no funds' })).toEqual({
      status: 'rejected',
      message: 'no funds',
    });
    expect(toTransferResult({ status: 'error' })).toEqual({
      status: 'rejected',
      message: 'rejected',
    });
  });
});
