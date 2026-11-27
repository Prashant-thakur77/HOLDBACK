import { describe, expect, it } from 'vitest';

import { PayloadError, parseWebhookBody } from '../functions/_shared/payload.ts';
import { enhancedEntry, rawEntry, signature } from './helpers/fixtures.ts';

describe('parseWebhookBody', () => {
  it('reads a raw delivery with its logs', () => {
    const sig = signature();
    const [tx] = parseWebhookBody([rawEntry(['Program log: hello'], { signature: sig, slot: 9 })]);
    expect(tx).toEqual({ signature: sig, slot: 9, failed: false, logs: ['Program log: hello'] });
  });

  it('marks failed raw transactions', () => {
    const entry = rawEntry([], { err: { InstructionError: [1, { Custom: 6003 }] } });
    expect(parseWebhookBody([entry])[0]?.failed).toBe(true);
  });

  it('treats a raw entry without logs as having none', () => {
    const entry = rawEntry([]);
    (entry.meta as { logMessages: unknown }).logMessages = null;
    expect(parseWebhookBody([entry])[0]?.logs).toEqual([]);
  });

  it('reads an enhanced delivery, which has no logs', () => {
    const sig = signature();
    const [tx] = parseWebhookBody([enhancedEntry({ signature: sig, slot: 3 })]);
    expect(tx).toEqual({ signature: sig, slot: 3, failed: false, logs: null });
    expect(parseWebhookBody([enhancedEntry({ err: 'boom' })])[0]?.failed).toBe(true);
  });

  it('orders a batch by slot and keeps delivery order inside a slot', () => {
    const [a, b, c] = [signature(), signature(), signature()];
    const batch = [
      rawEntry([], { signature: a, slot: 20 }),
      rawEntry([], { signature: b, slot: 10 }),
      rawEntry([], { signature: c, slot: 10 }),
    ];
    expect(parseWebhookBody(batch).map((tx) => tx.signature)).toEqual([b, c, a]);
  });

  it('accepts a single transaction that is not wrapped in an array', () => {
    expect(parseWebhookBody(rawEntry([]))).toHaveLength(1);
  });

  it('rejects anything else', () => {
    for (const body of [
      [{ hello: 'world' }],
      ['text'],
      [null],
      42,
      { transaction: {}, meta: {} },
    ]) {
      expect(() => parseWebhookBody(body)).toThrow(PayloadError);
    }
  });
});
