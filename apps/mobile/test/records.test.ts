import { describe, expect, it } from 'vitest';
import type { HoldRecord } from '@holdback/sdk';

import {
  faviconUrl,
  hostOf,
  phraseMatches,
  shouldAutoPlayVoiceNote,
  topEvidence,
} from '@/lib/evidence';
import { mergeHistory, toCsv, toJson } from '@/lib/exportHistory';
import { holdPhase, recordFromRow, sortForDisplay, upsertRecord } from '@/lib/holds';
import { maskPhone, normalisePhone } from '@/lib/phone';
import { MAX_EXPECTED_COST_LAMPORTS, judgePreview } from '@/lib/preview';
import { WalletActionError, classifyWalletError, isUserCancellation } from '@/lib/walletErrors';

const record = (overrides: Partial<HoldRecord> = {}): HoldRecord => ({
  pda: 'Hold1',
  sender: 'Sender',
  recipient: 'Recipient',
  mint: 'Mint',
  amount: '5000000',
  tier: 'UNKNOWN',
  origin: 'WALLET',
  status: 'PENDING',
  createdAt: '2026-11-27T10:00:00.000Z',
  releaseAt: '2026-11-27T10:30:00.000Z',
  evidenceHash: 'ab'.repeat(32),
  createSignature: null,
  settleSignature: null,
  ...overrides,
});

describe('hold records', () => {
  it('derives the phase from status and clock', () => {
    const before = Date.parse('2026-11-27T10:10:00Z');
    const after = Date.parse('2026-11-27T10:31:00Z');
    expect(holdPhase(record(), before)).toBe('undoable');
    expect(holdPhase(record(), after)).toBe('releasable');
    expect(holdPhase(record({ status: 'RELEASED' }), before)).toBe('released');
    expect(holdPhase(record({ status: 'RECLAIMED' }), after)).toBe('reclaimed');
  });

  it('reads a database row', () => {
    expect(
      recordFromRow({
        pda: 'Hold1',
        sender: 'Sender',
        recipient: 'Recipient',
        mint: null,
        amount: 5000000,
        tier: 3,
        origin: 1,
        status: 2,
        created_at: '2026-11-27T10:00:00+00:00',
        release_at: '2026-11-28T10:00:00+00:00',
        evidence_hash: 'cd'.repeat(32),
        create_signature: 'sig',
        settle_signature: null,
      }),
    ).toMatchObject({
      mint: null,
      amount: '5000000',
      tier: 'FLAGGED',
      origin: 'DEPOSIT_BOX',
      status: 'RECLAIMED',
    });
  });

  it('rejects rows that are incomplete or malformed', () => {
    expect(recordFromRow(null)).toBeNull();
    expect(recordFromRow({ pda: 'Hold1' })).toBeNull();
    expect(
      recordFromRow({ ...record(), created_at: 'x', release_at: 'y', tier: 9, status: 0 }),
    ).toBeNull();
    expect(
      recordFromRow({
        pda: 'a',
        sender: 'b',
        recipient: 'c',
        amount: '1.5',
        tier: 1,
        status: 0,
        created_at: 'x',
        release_at: 'y',
      }),
    ).toBeNull();
  });

  it('upserts by address and keeps newest first', () => {
    const older = record({ pda: 'A', createdAt: '2026-11-26T10:00:00.000Z' });
    const newer = record({ pda: 'B', createdAt: '2026-11-27T10:00:00.000Z' });
    const updated = upsertRecord([newer, older], { ...older, status: 'RECLAIMED' });
    expect(updated.map((item) => [item.pda, item.status])).toEqual([
      ['B', 'PENDING'],
      ['A', 'RECLAIMED'],
    ]);
  });

  it('shows pending holds first, soonest release on top', () => {
    const sorted = sortForDisplay([
      record({ pda: 'settled', status: 'RELEASED' }),
      record({ pda: 'later', releaseAt: '2026-11-28T10:00:00.000Z' }),
      record({ pda: 'sooner', releaseAt: '2026-11-27T10:05:00.000Z' }),
    ]);
    expect(sorted.map((item) => item.pda)).toEqual(['sooner', 'later', 'settled']);
  });
});

describe('history export', () => {
  const entries = mergeHistory(
    [record({ pda: 'sent', createdAt: '2026-11-27T10:00:00.000Z' })],
    [record({ pda: 'got', createdAt: '2026-11-27T11:00:00.000Z' })],
  );

  it('merges both directions, newest first', () => {
    expect(entries.map((entry) => [entry.pda, entry.direction])).toEqual([
      ['got', 'received'],
      ['sent', 'sent'],
    ]);
  });

  it('writes a CSV with a header and one line per hold', () => {
    const lines = toCsv(entries).trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      'direction,pda,status,tier,amount,mint,sender,recipient,origin,createdAt,releaseAt,evidenceHash,createSignature,settleSignature',
    );
    expect(lines[1]?.startsWith('received,got,PENDING,UNKNOWN,5000000,Mint,')).toBe(true);
  });

  it('quotes special characters and defuses spreadsheet formulas', () => {
    const csv = toCsv(mergeHistory([record({ recipient: '=HYPERLINK("x")', sender: 'a,b' })], []));
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"a,b"');
  });

  it('writes JSON that parses back', () => {
    const parsed = JSON.parse(toJson(entries, 'Wallet', '2026-11-27T12:00:00.000Z'));
    expect(parsed).toMatchObject({ wallet: 'Wallet', count: 2 });
    expect(parsed.holds[0].pda).toBe('got');
  });
});

describe('evidence helpers', () => {
  it('orders evidence by how much it moved the score', () => {
    const items = [
      { source: 'a', signal: 's', weight: 5, detail: '' },
      { source: 'b', signal: 's', weight: -30, detail: '' },
      { source: 'c', signal: 's', weight: 40, detail: '' },
      { source: 'd', signal: 's', weight: 10, detail: '' },
    ];
    expect(topEvidence(items, 3).map((item) => item.source)).toEqual(['c', 'b', 'd']);
  });

  it('only derives hosts and favicons from http(s) links', () => {
    expect(hostOf('https://www.Example.org/report/1')).toBe('example.org');
    expect(faviconUrl('https://chainabuse.com/address/x')).toBe(
      'https://chainabuse.com/favicon.ico',
    );
    expect(hostOf('javascript:alert(1)')).toBeNull();
    expect(faviconUrl('intent://evil')).toBeNull();
    expect(hostOf(undefined)).toBeNull();
  });

  it('auto-plays the voice note for the two warning tiers only', () => {
    expect(shouldAutoPlayVoiceNote('SUSPICIOUS')).toBe(true);
    expect(shouldAutoPlayVoiceNote('FLAGGED')).toBe(true);
    expect(shouldAutoPlayVoiceNote('UNKNOWN')).toBe(false);
    expect(shouldAutoPlayVoiceNote('TRUSTED')).toBe(false);
    expect(shouldAutoPlayVoiceNote('SANCTIONED')).toBe(false);
  });

  it('matches the sanction phrase loosely on case and spacing, strictly on words', () => {
    expect(phraseMatches('  i understand   the RISK ', 'I understand the risk')).toBe(true);
    expect(phraseMatches('I understand', 'I understand the risk')).toBe(false);
    expect(phraseMatches('', '')).toBe(false);
  });
});

describe('simulation verdict', () => {
  it('accepts a token payment that moves exactly the amount', () => {
    expect(
      judgePreview({
        amount: 5_000_000n,
        isSol: false,
        tokenDelta: -5_000_000n,
        solDelta: -2_500_000n,
      }),
    ).toEqual({
      outflow: 5_000_000n,
      costLamports: 2_500_000n,
      mismatch: false,
    });
  });

  it('flags a simulation that moves more tokens than entered', () => {
    expect(
      judgePreview({ amount: 5_000_000n, isSol: false, tokenDelta: -9_000_000n, solDelta: -5_000n })
        .mismatch,
    ).toBe(true);
  });

  it('separates the amount from the cost for a SOL payment', () => {
    const verdict = judgePreview({
      amount: 1_000_000_000n,
      isSol: true,
      tokenDelta: 0n,
      solDelta: -1_002_000_000n,
    });
    expect(verdict).toEqual({ outflow: 1_000_000_000n, costLamports: 2_000_000n, mismatch: false });
  });

  it('flags an unexpectedly large SOL outflow', () => {
    const drain = -(1_000_000_000n + MAX_EXPECTED_COST_LAMPORTS + 1n);
    expect(
      judgePreview({ amount: 1_000_000_000n, isSol: true, tokenDelta: 0n, solDelta: drain })
        .mismatch,
    ).toBe(true);
    expect(
      judgePreview({ amount: 1n, isSol: false, tokenDelta: -1n, solDelta: drain }).mismatch,
    ).toBe(true);
  });
});

describe('phone numbers', () => {
  it('normalises to E.164', () => {
    expect(normalisePhone('+91 98765-43210')).toBe('+919876543210');
    expect(normalisePhone('+1 (415) 555.0100')).toBe('+14155550100');
  });

  it('rejects numbers without a country code or with letters', () => {
    expect(normalisePhone('9876543210')).toBeNull();
    expect(normalisePhone('+0123456789')).toBeNull();
    expect(normalisePhone('+91 call me')).toBeNull();
    expect(normalisePhone('+123')).toBeNull();
  });

  it('masks all but the prefix and the last four digits', () => {
    expect(maskPhone('+919876543210')).toBe('+91 ••••••3210');
  });
});

describe('wallet errors', () => {
  it('recognises the ways a user can back out', () => {
    expect(classifyWalletError({ code: 'ERROR_ASSOCIATION_CANCELLED' })).toBe('cancelled');
    expect(classifyWalletError(new Error('java.util.concurrent.CancellationException'))).toBe(
      'cancelled',
    );
    expect(classifyWalletError(new Error('Local association cancelled by user'))).toBe('cancelled');
    expect(classifyWalletError({ code: -3, message: 'not signed' })).toBe('cancelled');
    expect(isUserCancellation(new Error('User declined the request'))).toBe(true);
  });

  it('recognises a phone without a wallet app', () => {
    expect(classifyWalletError({ code: 'ERROR_WALLET_NOT_FOUND' })).toBe('no_wallet');
    expect(
      classifyWalletError(
        new Error('Found no installed wallet that supports the mobile wallet protocol'),
      ),
    ).toBe('no_wallet');
  });

  it('treats everything else as a real failure', () => {
    expect(classifyWalletError(new Error('payloads invalid for signing'))).toBe('failed');
    expect(classifyWalletError(undefined)).toBe('failed');
  });

  it('carries the kind and signature on WalletActionError', () => {
    const error = new WalletActionError('onchain', 'WindowOver', 'sig');
    expect(error).toMatchObject({ kind: 'onchain', detail: 'WindowOver', signature: 'sig' });
  });
});
