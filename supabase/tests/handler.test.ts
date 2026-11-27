import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { timingSafeEqual } from '../functions/_shared/auth.ts';
import {
  createHandler,
  type HandlerDeps,
  type IngestOutcome,
  type IngestResult,
} from '../functions/_shared/handler.ts';
import type { IngestEvent } from '../functions/_shared/records.ts';
import { createLogFetcher } from '../functions/_shared/rpc.ts';
import { parseStablecoins } from '../functions/_shared/stablecoins.ts';
import {
  PROGRAM_ID,
  SECRET,
  address,
  delivery,
  enhancedEntry,
  holdCreated,
  holdReclaimed,
  holdbackInstruction,
  instantTransfer,
  invocation,
  newHold,
  rawEntry,
  signature,
  transactionLogs,
  windowExtended,
} from './helpers/fixtures.ts';

/**
 * Stands in for the database function. It records what it was given and
 * answers every row with `outcome`; the SQL itself is exercised by
 * `sql/ingest.test.sql` against a real Postgres.
 */
function recordingStore(
  outcome: IngestOutcome | ((event: IngestEvent) => IngestOutcome) = 'applied',
) {
  const calls: IngestEvent[][] = [];
  const ingest = async (events: IngestEvent[]): Promise<IngestResult[]> => {
    calls.push(events);
    return events.map((event) => ({
      kind: event.kind,
      ref: 'pda' in event ? event.pda : event.signature,
      outcome: typeof outcome === 'function' ? outcome(event) : outcome,
    }));
  };
  return { calls, ingest };
}

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    secret: SECRET,
    programId: PROGRAM_ID,
    stablecoins: parseStablecoins(undefined),
    ingest: recordingStore().ingest,
    ...overrides,
  };
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

const hold = newHold();
const createLogs = transactionLogs(holdbackInstruction('CreateHold', [holdCreated(hold)]));
const reclaimLogs = transactionLogs(holdbackInstruction('Reclaim', [holdReclaimed(hold)]));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('authentication', () => {
  it('compares secrets exactly', async () => {
    expect(await timingSafeEqual('abc', 'abc')).toBe(true);
    expect(await timingSafeEqual('abc', 'abd')).toBe(false);
    expect(await timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(await timingSafeEqual('', 'abc')).toBe(false);
  });

  it('rejects a missing or wrong Authorization header before touching the store', async () => {
    const store = recordingStore();
    const handler = createHandler(deps({ ingest: store.ingest }));
    for (const authorization of [null, 'wrong', `${SECRET}x`, `Bearer ${SECRET}`]) {
      const response = await handler(delivery([rawEntry(createLogs)], authorization));
      expect(response.status).toBe(401);
      expect(await body(response)).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
    }
    expect(store.calls).toHaveLength(0);
  });

  it('refuses every request while no secret is configured', async () => {
    for (const secret of [undefined, '']) {
      const handler = createHandler(deps({ secret }));
      const response = await handler(delivery([rawEntry(createLogs)], ''));
      expect(response.status).toBe(500);
      expect(await body(response)).toMatchObject({ error: { code: 'not_configured' } });
    }
  });

  it('only accepts POST', async () => {
    const request = new Request('https://project.supabase.co/functions/v1/helius-webhook', {
      headers: { authorization: SECRET },
    });
    expect((await createHandler(deps())(request)).status).toBe(405);
  });
});

describe('raw deliveries', () => {
  it('stores the events of a create and a reclaim', async () => {
    const store = recordingStore();
    const handler = createHandler(deps({ ingest: store.ingest }));
    const [createSig, reclaimSig] = [signature(), signature()];

    const response = await handler(
      delivery([
        rawEntry(reclaimLogs, { signature: reclaimSig, slot: 101 }),
        rawEntry(createLogs, { signature: createSig, slot: 100 }),
      ]),
    );

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({
      ok: true,
      transactions: 2,
      events: 2,
      applied: 2,
      duplicates: 0,
    });
    // One database call for the whole delivery, creation first.
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0]).toMatchObject([
      { kind: 'hold_created', signature: createSig, pda: hold.hold, amount_usd: '25.00' },
      { kind: 'hold_settled', signature: reclaimSig, pda: hold.hold, status: 2 },
    ]);
  });

  it('ignores a failed transaction, whatever it logged', async () => {
    const store = recordingStore();
    const handler = createHandler(deps({ ingest: store.ingest }));
    const failed = rawEntry(createLogs, { err: { InstructionError: [2, { Custom: 6001 }] } });

    const response = await handler(delivery([failed]));

    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({ transactions: 1, events: 0 });
    expect(store.calls).toHaveLength(0);
  });

  it('ignores events another program logged', async () => {
    const store = recordingStore();
    const handler = createHandler(deps({ ingest: store.ingest }));
    const forged = transactionLogs(invocation(address(), [holdCreated(hold)]));

    const response = await handler(delivery([rawEntry(forged)]));

    expect(await body(response)).toMatchObject({ ok: true, events: 0 });
    expect(store.calls).toHaveLength(0);
  });

  it('reports a replayed delivery as duplicates', async () => {
    const handler = createHandler(deps({ ingest: recordingStore('duplicate').ingest }));
    const response = await handler(delivery([rawEntry(createLogs)]));
    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({ ok: true, applied: 0, duplicates: 1 });
  });

  it('asks for a retry when an event refers to a hold that is not stored yet', async () => {
    const store = recordingStore((event) =>
      event.kind === 'hold_settled' ? 'unknown_hold' : 'applied',
    );
    const handler = createHandler(deps({ ingest: store.ingest }));
    const instant = transactionLogs(holdbackInstruction('InstantTransfer', [instantTransfer()]));

    const response = await handler(delivery([rawEntry(reclaimLogs), rawEntry(instant)]));

    expect(response.status).toBe(503);
    expect(await body(response)).toEqual({
      ok: false,
      error: { code: 'retry_later', message: 'Some events could not be applied yet.' },
      applied: 1,
      unknownHolds: [hold.hold],
      pendingSignatures: [],
    });
  });

  it('answers 400 for a body that is not a Helius delivery', async () => {
    const handler = createHandler(deps());
    for (const payload of ['{not json', JSON.stringify([{ hello: 'world' }])]) {
      const response = await handler(delivery(payload));
      expect(response.status).toBe(400);
      expect(await body(response)).toMatchObject({ error: { code: 'invalid_payload' } });
    }
  });

  it('answers 500 without details when the database call fails', async () => {
    const handler = createHandler(
      deps({
        ingest: async () => {
          throw new Error('connection refused at 10.0.0.5');
        },
      }),
    );
    const response = await handler(delivery([rawEntry(createLogs)]));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await body(response))).not.toContain('10.0.0.5');
  });
});

describe('enhanced deliveries', () => {
  const extendLogs = transactionLogs(holdbackInstruction('ExtendWindow', [windowExtended(hold)]));

  it('fetches the logs by signature', async () => {
    const store = recordingStore();
    const sig = signature();
    const fetchLogs = vi.fn(async () => ({ failed: false, logs: extendLogs }));
    const handler = createHandler(deps({ ingest: store.ingest, fetchLogs }));

    const response = await handler(delivery([enhancedEntry({ signature: sig })]));

    expect(response.status).toBe(200);
    expect(fetchLogs).toHaveBeenCalledWith(sig);
    expect(store.calls[0]).toMatchObject([{ kind: 'window_extended', signature: sig, tier: 3 }]);
  });

  it('says so when no RPC endpoint is configured', async () => {
    const response = await createHandler(deps())(delivery([enhancedEntry()]));
    expect(response.status).toBe(500);
    expect(await body(response)).toMatchObject({ error: { code: 'rpc_not_configured' } });
  });

  it('asks for a retry while the node does not know the transaction', async () => {
    const sig = signature();
    const handler = createHandler(deps({ fetchLogs: async () => null }));
    const response = await handler(delivery([enhancedEntry({ signature: sig })]));
    expect(response.status).toBe(503);
    expect(await body(response)).toMatchObject({ pendingSignatures: [sig], unknownHolds: [] });
  });

  it('skips a transaction the node reports as failed', async () => {
    const store = recordingStore();
    const fetchLogs = async () => ({ failed: true, logs: createLogs });
    const handler = createHandler(deps({ ingest: store.ingest, fetchLogs }));
    expect((await handler(delivery([enhancedEntry()]))).status).toBe(200);
    expect(store.calls).toHaveLength(0);
  });

  it('answers 502 when the node cannot be reached', async () => {
    const fetchLogs = async () => {
      throw new Error('timeout');
    };
    const response = await createHandler(deps({ fetchLogs }))(delivery([enhancedEntry()]));
    expect(response.status).toBe(502);
    expect(await body(response)).toMatchObject({ error: { code: 'logs_unavailable' } });
  });
});

describe('createLogFetcher', () => {
  const rpc = (payload: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(payload), { status })) as unknown as typeof fetch;

  it('asks getTransaction for the confirmed logs', async () => {
    const fetcher = rpc({ result: { meta: { err: null, logMessages: createLogs } } });
    const logs = await createLogFetcher('https://rpc.example', fetcher)('the-signature');

    expect(logs).toEqual({ failed: false, logs: createLogs });
    const [url, init] = vi.mocked(fetcher).mock.calls[0]!;
    expect(url).toBe('https://rpc.example');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      method: 'getTransaction',
      params: [
        'the-signature',
        { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
      ],
    });
  });

  it('reports failed transactions and unknown ones', async () => {
    const failed = rpc({
      result: { meta: { err: { InstructionError: [0, 'Custom'] }, logMessages: [] } },
    });
    expect(await createLogFetcher('https://rpc.example', failed)('s')).toMatchObject({
      failed: true,
    });
    expect(await createLogFetcher('https://rpc.example', rpc({ result: null }))('s')).toBeNull();
  });

  it('throws on RPC and HTTP errors', async () => {
    const rpcError = rpc({ error: { code: -32005, message: 'rate limited' } });
    await expect(createLogFetcher('https://rpc.example', rpcError)('s')).rejects.toThrow(
      'rate limited',
    );
    await expect(createLogFetcher('https://rpc.example', rpc({}, 500))('s')).rejects.toThrow('500');
  });
});
