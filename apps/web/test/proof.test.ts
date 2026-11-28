import { createHash } from 'node:crypto';

import { PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import { attackerOf, parseProgramBuild, parseProofReport, type Proof } from '@/lib/proof/data';
import {
  fetchAccountBytes,
  judgeProof,
  observedError,
  programHash,
  readProgramData,
  retryDelay,
  rpcCall,
  runLimited,
  toBase58,
  type ObservedTransaction,
} from '@/lib/proof/verify';

// Fixtures only: made-up ids, logs and bytes that have the shape of the real ones.
const PROGRAM = 'Prog1111111111111111111111111111111111111111';
const INVOKE = `Program ${PROGRAM} invoke [1]`;

const happy: Pick<Proof, 'id' | 'kind' | 'error'> = { id: 'H1', kind: 'happy path', error: null };
const attack: Pick<Proof, 'id' | 'kind' | 'error'> = {
  id: 'A1',
  kind: 'attack',
  error: 'Unauthorized',
};

function tx(err: unknown, logs: string[]): ObservedTransaction {
  return { meta: { err, logMessages: logs } };
}

describe('observedError', () => {
  it("prefers the program's own error name from the logs", () => {
    const logs = [
      INVOKE,
      'Program log: AnchorError occurred. Error Code: WindowNotOver. Error Number: 6003.',
    ];
    expect(observedError(logs, { InstructionError: [0, { Custom: 6003 }] })).toBe('WindowNotOver');
  });

  it('names the system program refusal when an account is already in use', () => {
    const logs = ['Allocate: account Address { address: X } already in use'];
    expect(observedError(logs, { InstructionError: [0, { Custom: 0 }] })).toBe(
      'AccountAlreadyInUse (system program)',
    );
  });

  it('falls back to the raw error', () => {
    expect(observedError([], { InstructionError: [1, 'InvalidArgument'] })).toBe(
      '{"InstructionError":[1,"InvalidArgument"]}',
    );
  });
});

describe('judgeProof', () => {
  it('passes a happy path that succeeded', () => {
    expect(judgeProof(happy, tx(null, [INVOKE]), PROGRAM)).toEqual({
      pass: true,
      detail: 'Executed on-chain.',
    });
  });

  it('fails a happy path that failed', () => {
    expect(judgeProof(happy, tx({ InstructionError: [0, 'Custom'] }, [INVOKE]), PROGRAM).pass).toBe(
      false,
    );
  });

  it('passes an attack refused with the recorded error', () => {
    const logs = [
      INVOKE,
      'Program log: AnchorError. Error Code: Unauthorized. Error Number: 6000.',
    ];
    expect(
      judgeProof(attack, tx({ InstructionError: [0, { Custom: 6000 }] }, logs), PROGRAM),
    ).toEqual({ pass: true, detail: 'Refused on-chain with Unauthorized.' });
  });

  it('fails an attack refused for a different reason than the record says', () => {
    const logs = [INVOKE, 'Program log: AnchorError. Error Code: WindowOver. Error Number: 6004.'];
    const verdict = judgeProof(
      attack,
      tx({ InstructionError: [0, { Custom: 6004 }] }, logs),
      PROGRAM,
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.detail).toContain('WindowOver');
  });

  it('fails an attack that executed', () => {
    expect(judgeProof(attack, tx(null, [INVOKE]), PROGRAM)).toEqual({
      pass: false,
      detail: 'The attack executed.',
    });
  });

  it('fails when the transaction is missing or never called the program', () => {
    expect(judgeProof(happy, null, PROGRAM).pass).toBe(false);
    expect(judgeProof(happy, tx(null, ['Program Other invoke [1]']), PROGRAM)).toEqual({
      pass: false,
      detail: 'The transaction did not call the program.',
    });
  });

  it('does not ask the plain transfer into a deposit box to call the program', () => {
    const transfer = { id: 'H18', kind: 'happy path', error: null } as const;
    expect(judgeProof(transfer, tx(null, ['Program Token invoke [1]']), PROGRAM).pass).toBe(true);
  });
});

describe('the deployed program', () => {
  const authority = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const body = Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 9, 0, 8, 7]);

  function account(withAuthority: boolean, padding: number): Uint8Array {
    const data = new Uint8Array(45 + body.length + padding);
    data[0] = 3;
    if (withAuthority) {
      data[12] = 1;
      data.set(authority, 13);
    }
    data.set(body, 45);
    return data;
  }

  it('reads the upgrade authority only when the flag byte says there is one', () => {
    expect(readProgramData(account(true, 0)).authority).toEqual(authority);
    expect(readProgramData(account(false, 0)).authority).toBeNull();
  });

  it('hashes the bytes after the header, without the zero padding at the end', async () => {
    const expected = createHash('sha256').update(body).digest('hex');
    expect(await programHash(account(true, 0))).toBe(expected);
    expect(await programHash(account(true, 4096))).toBe(expected);
    expect(await programHash(account(false, 17))).toBe(expected);
  });

  it('keeps zero bytes that are inside the program', () => {
    expect([...readProgramData(account(true, 3)).body]).toEqual([...body]);
  });

  it('prints addresses the way Solana does', () => {
    expect(toBase58(authority)).toBe(new PublicKey(authority).toBase58());
    expect(toBase58(new Uint8Array(32))).toBe(PublicKey.default.toBase58());
  });
});

describe('rpcCall', () => {
  const noWait = () => Promise.resolve();
  const answer = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('tries again after a rate-limit answer, then returns the result', async () => {
    const replies = [answer(429, {}), answer(200, { error: { code: 429, message: 'slow down' } })];
    let calls = 0;
    const result = await rpcCall<number>('https://rpc.test', 'getSlot', [], {
      wait: noWait,
      fetcher: async () => {
        calls++;
        return replies.shift() ?? answer(200, { result: 7 });
      },
    });
    expect(result).toBe(7);
    expect(calls).toBe(3);
  });

  it('waits as long as the endpoint asks, within reason, else a growing pause', () => {
    const asks = (value: string | null) => ({
      headers: new Headers(value === null ? {} : { 'retry-after': value }),
    });
    expect(retryDelay(asks('3'), 0)).toBe(3000);
    expect(retryDelay(asks('600'), 0)).toBe(15000);
    expect(retryDelay(asks(null), 0)).toBe(1000);
    expect(retryDelay(asks(null), 2)).toBe(3000);
    expect(retryDelay(asks(null), 40)).toBe(6000);
  });

  it('gives up when the endpoint keeps refusing', async () => {
    await expect(
      rpcCall('https://rpc.test', 'getSlot', [], {
        wait: noWait,
        retries: 2,
        fetcher: async () => answer(429, {}),
      }),
    ).rejects.toThrow('429');
  });

  it('decodes account bytes and reports a missing account as null', async () => {
    const present = await fetchAccountBytes('https://rpc.test', 'addr', {
      fetcher: async () => answer(200, { result: { value: { data: ['AQID', 'base64'] } } }),
    });
    expect([...(present ?? [])]).toEqual([1, 2, 3]);
    const missing = await fetchAccountBytes('https://rpc.test', 'addr', {
      fetcher: async () => answer(200, { result: { value: null } }),
    });
    expect(missing).toBeNull();
  });
});

describe('runLimited', () => {
  it('never runs more than the limit at once and visits every item', async () => {
    let running = 0;
    let peak = 0;
    const seen: number[] = [];
    await runLimited([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      seen.push(item);
      running--;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('proof files', () => {
  const entry = {
    id: 'A1',
    kind: 'attack',
    description: 'A stranger tries to undo someone else’s hold',
    expected: 'Unauthorized',
    outcome: 'refused',
    error: 'Unauthorized',
    signature: 'S'.repeat(64),
    explorer: 'https://explorer.solana.com/tx/abc?cluster=devnet',
  };

  it('reads a report and rejects one that is incomplete', () => {
    const report = {
      generated_at: '2026-11-28T00:00:00.000Z',
      cluster: 'devnet',
      program: PROGRAM,
      counts: { happy_paths: 0, attacks_refused: 1 },
      proofs: [entry],
    };
    expect(parseProofReport(JSON.stringify(report))?.proofs).toHaveLength(1);
    expect(parseProofReport(JSON.stringify({ ...report, proofs: [{ id: 'A1' }] }))).toBeNull();
    expect(parseProofReport('')).toBeNull();
    expect(parseProofReport('{broken')).toBeNull();
  });

  it('reads the build record and insists on a full sha256', () => {
    const build = { program_hash: 'ab'.repeat(32), base_image: 'image:1', commit: 'abc1234' };
    expect(parseProgramBuild(JSON.stringify(build))?.commit).toBe('abc1234');
    expect(parseProgramBuild(JSON.stringify({ ...build, program_hash: 'abc' }))).toBeNull();
  });

  it('sorts attacks under whoever attempts them', () => {
    const by = (description: string) => attackerOf({ description });
    expect(by('A stranger tries to release the hold before the window ends')).toBe('stranger');
    expect(by('A stranger signs as the risk oracle')).toBe('stranger');
    expect(by('The relayer withdraws box funds to itself')).toBe('relayer');
    expect(by('The oracle tries to shorten the window by one second')).toBe('oracle');
    expect(by('The sender tries to undo the same hold twice')).toBe('sender');
    expect(by('An assessment signed by someone other than the risk oracle')).toBe('impostor');
    expect(by('The amount is changed after the oracle signed the assessment')).toBe('impostor');
    expect(by('An attested hold sent without the oracle’s signature')).toBe('impostor');
    expect(by('The sender asks for a shorter window than the oracle signed')).toBe('impostor');
  });
});
