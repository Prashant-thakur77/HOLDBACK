import { GuardianError, IDL } from '@holdback/sdk';
import { describe, expect, it } from 'vitest';

import { IntegrationUnavailableError } from '@/lib/errors';
import { holdPermissions, rowToRecord, upsertRecord } from '@/lib/holds';
import { toTxError } from '@/lib/tx';

describe('toTxError', () => {
  it('decodes a HOLDBACK program error from simulation logs', () => {
    const known = IDL.errors[0]!;
    const error = toTxError({
      logs: [`Program failed: custom program error: 0x${known.code.toString(16)}`],
    });
    expect(error.kind).toBe('program_error');
    expect(error.program).toEqual({ code: known.code, name: known.name, message: known.msg });
    expect(error.message).toBe(known.msg);
  });

  it('classifies wallet, agent and network failures', () => {
    expect(toTxError(new Error('User rejected the request.')).kind).toBe('rejected');
    expect(toTxError(new Error('Signature x has expired: block height exceeded.')).kind).toBe(
      'expired',
    );
    expect(toTxError(new GuardianError(503, 'unavailable', 'down')).kind).toBe('agent_unavailable');
    expect(toTxError(new GuardianError(422, 'bad_request', 'bad amount')).kind).toBe(
      'assessment_failed',
    );
    expect(toTxError(new IntegrationUnavailableError('agent', 'not configured')).kind).toBe(
      'agent_unavailable',
    );
    expect(toTxError(new Error('socket hang up'))).toEqual({
      kind: 'send_failed',
      message: 'socket hang up',
      program: null,
    });
    expect(toTxError(new TypeError('fetch failed'), 'agent_unavailable').kind).toBe(
      'agent_unavailable',
    );
  });
});

const row = {
  pda: 'H'.repeat(44),
  sender: 'S'.repeat(44),
  recipient: 'R'.repeat(44),
  mint: null,
  amount: 2_500_000,
  tier: 2,
  origin: 0,
  status: 0,
  created_at: '2026-11-27T10:00:00+00:00',
  release_at: '2026-11-27T16:00:00+00:00',
  evidence_hash: 'ab'.repeat(32),
  create_signature: 'sig',
  settle_signature: null,
  amount_usd: 2.5,
};

describe('holds mirror rows', () => {
  it('maps a database row to the shared record shape', () => {
    expect(rowToRecord(row)).toEqual({
      pda: row.pda,
      sender: row.sender,
      recipient: row.recipient,
      mint: null,
      amount: '2500000',
      tier: 'SUSPICIOUS',
      origin: 'WALLET',
      status: 'PENDING',
      createdAt: '2026-11-27T10:00:00.000Z',
      releaseAt: '2026-11-27T16:00:00.000Z',
      evidenceHash: row.evidence_hash,
      createSignature: 'sig',
      settleSignature: null,
    });
    expect(rowToRecord({ ...row, amount: '18446744073709551615' })?.amount).toBe(
      '18446744073709551615',
    );
  });

  it('refuses rows it cannot represent exactly', () => {
    expect(rowToRecord({ ...row, amount: 2 ** 60 })).toBeNull();
    expect(rowToRecord({ ...row, tier: 9 })).toBeNull();
    expect(rowToRecord({})).toBeNull();
  });

  it('upserts by address and keeps the newest first', () => {
    const first = rowToRecord(row)!;
    const newer = { ...first, pda: 'N'.repeat(44), createdAt: '2026-11-27T11:00:00.000Z' };
    const settled = { ...first, status: 'RELEASED' as const };
    const list = upsertRecord(upsertRecord([first], newer), settled);
    expect(list.map((item) => [item.pda, item.status])).toEqual([
      [newer.pda, 'PENDING'],
      [first.pda, 'RELEASED'],
    ]);
  });
});

describe('holdPermissions', () => {
  const record = rowToRecord(row)!;
  const during = Date.parse(record.releaseAt) - 1_000;
  const after = Date.parse(record.releaseAt);

  it('lets only the sender undo, and only while the window is open', () => {
    expect(holdPermissions(record, record.sender, during)).toMatchObject({
      reclaim: true,
      releaseEarly: true,
      release: false,
      close: false,
    });
    expect(holdPermissions(record, record.sender, after).reclaim).toBe(false);
    expect(holdPermissions(record, record.recipient, during).reclaim).toBe(false);
    expect(holdPermissions(record, null, during).reclaim).toBe(false);
  });

  it('lets anyone release after the window and close once settled', () => {
    expect(holdPermissions(record, record.recipient, after).release).toBe(true);
    expect(holdPermissions(record, record.recipient, during).release).toBe(false);
    const settled = { ...record, status: 'RECLAIMED' as const };
    expect(holdPermissions(settled, record.recipient, after)).toMatchObject({
      reclaim: false,
      releaseEarly: false,
      release: false,
      close: true,
    });
  });
});
