import { describe, expect, it } from 'vitest';

import { confirmSignature, type SignatureStatus, type StatusSource } from '@/lib/confirm';

/** A status source that answers from a script, then repeats its last answer. */
function source(
  statuses: (SignatureStatus | null | Error)[],
  heights: number[] = [100],
): StatusSource & { polls: number } {
  const statusScript = [...statuses];
  const heightScript = [...heights];
  const fake = {
    polls: 0,
    async getSignatureStatuses() {
      fake.polls += 1;
      const next = statusScript.length > 1 ? statusScript.shift()! : statusScript[0]!;
      if (next instanceof Error) throw next;
      return { value: [next] };
    },
    async getBlockHeight() {
      return heightScript.length > 1 ? heightScript.shift()! : heightScript[0]!;
    },
  };
  return fake;
}

const instant = { sleep: async () => undefined };

describe('confirmSignature', () => {
  it('polls until the transaction is confirmed', async () => {
    const rpc = source([
      null,
      { confirmationStatus: 'processed', err: null },
      { confirmationStatus: 'confirmed', err: null },
    ]);
    expect(await confirmSignature(rpc, 'sig', 200, instant)).toEqual({ status: 'confirmed' });
    expect(rpc.polls).toBe(3);
  });

  it('treats finalized as confirmed', async () => {
    const rpc = source([{ confirmationStatus: 'finalized', err: null }]);
    expect(await confirmSignature(rpc, 'sig', 200, instant)).toEqual({ status: 'confirmed' });
  });

  it('reports a transaction that landed and failed', async () => {
    const err = { InstructionError: [2, { Custom: 6004 }] };
    const rpc = source([{ confirmationStatus: 'confirmed', err }]);
    expect(await confirmSignature(rpc, 'sig', 200, instant)).toEqual({
      status: 'failed',
      error: err,
    });
  });

  it('reports expiry once the block height passes the last valid one', async () => {
    const rpc = source([null], [150, 201]);
    expect(await confirmSignature(rpc, 'sig', 200, instant)).toEqual({ status: 'expired' });
  });

  it('survives a failing status request', async () => {
    const rpc = source([new Error('rpc 429'), { confirmationStatus: 'confirmed', err: null }]);
    expect(await confirmSignature(rpc, 'sig', 200, instant)).toEqual({ status: 'confirmed' });
  });

  it('times out when nothing is known and expiry cannot be checked', async () => {
    let clock = 0;
    const rpc = source([null]);
    const outcome = await confirmSignature(rpc, 'sig', null, {
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      timeoutMs: 5_000,
      intervalMs: 1_000,
    });
    expect(outcome).toEqual({ status: 'timeout' });
  });
});
