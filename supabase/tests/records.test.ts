import { describe, expect, it } from 'vitest';

import { parseEvents } from '../functions/_shared/events.ts';
import { toIngestEvents } from '../functions/_shared/records.ts';
import { parseStablecoins, toUsd, usdValue } from '../functions/_shared/stablecoins.ts';
import {
  CREATED_AT,
  DEVNET_USDC,
  PROGRAM_ID,
  SOL_MINT,
  address,
  eventLog,
  evidenceHashHex,
  holdCreated,
  holdReclaimed,
  holdReleased,
  instantTransfer,
  invocation,
  newHold,
  windowExtended,
} from './helpers/fixtures.ts';

const stablecoins = parseStablecoins(undefined);
const SIG = 'sig';

/** Decodes the given event log lines as HOLDBACK output and maps them to rows. */
function rows(...eventLogs: string[]) {
  return toIngestEvents(SIG, parseEvents(invocation(PROGRAM_ID, eventLogs)), stablecoins);
}

describe('toIngestEvents', () => {
  const hold = newHold();

  it('maps HoldCreated to a holds row with a USD value for a stablecoin', () => {
    expect(rows(holdCreated(hold))).toEqual([
      {
        kind: 'hold_created',
        signature: SIG,
        pda: hold.hold,
        sender: hold.sender,
        recipient: hold.recipient,
        mint: DEVNET_USDC,
        amount: '25000000',
        tier: 2,
        origin: 0,
        nonce: '1882193920000123',
        created_at: Number(CREATED_AT),
        release_at: Number(CREATED_AT) + 21_600,
        evidence_hash: evidenceHashHex,
        amount_usd: '25.00',
      },
    ]);
  });

  it('stores a SOL hold with a null mint and no USD value', () => {
    const [row] = rows(holdCreated(newHold({ mint: SOL_MINT, amount: 2_000_000_000n })));
    expect(row).toMatchObject({ mint: null, amount: '2000000000', amount_usd: null });
  });

  it('leaves the USD value empty for a mint that is not a listed stablecoin', () => {
    const [row] = rows(holdCreated(newHold({ mint: address() })));
    expect(row).toMatchObject({ amount_usd: null });
  });

  it('keeps a u64 amount exact', () => {
    const [row] = rows(holdCreated(newHold({ amount: 18_446_744_073_709_551_615n })));
    expect(row).toMatchObject({ amount: '18446744073709551615' });
  });

  it('maps WindowExtended to the new release time, tier and evidence hash', () => {
    expect(rows(windowExtended(hold))).toEqual([
      {
        kind: 'window_extended',
        signature: SIG,
        pda: hold.hold,
        release_at: Number(CREATED_AT) + 86_400,
        tier: 3,
        evidence_hash: 'ab'.repeat(32),
      },
    ]);
  });

  it('maps HoldReclaimed and HoldReleased to their status codes', () => {
    expect(rows(holdReclaimed(hold), holdReleased(hold))).toEqual([
      {
        kind: 'hold_settled',
        signature: SIG,
        pda: hold.hold,
        status: 2,
        settled_at: Number(CREATED_AT) + 120,
      },
      {
        kind: 'hold_settled',
        signature: SIG,
        pda: hold.hold,
        status: 1,
        settled_at: Number(CREATED_AT) + 21_600,
      },
    ]);
  });

  it('maps InstantTransfer to an instant_transfers row', () => {
    const sender = address();
    const recipient = address();
    expect(rows(instantTransfer({ sender, recipient, mint: SOL_MINT }))).toEqual([
      {
        kind: 'instant_transfer',
        signature: SIG,
        sender,
        recipient,
        mint: null,
        amount: '5000000',
        created_at: Number(CREATED_AT),
      },
    ]);
  });

  it('keeps only the last extension of a hold within one transaction', () => {
    const other = newHold();
    const result = rows(
      windowExtended(hold, { newReleaseAt: CREATED_AT + 30_000n, tier: 2 }),
      windowExtended(other),
      windowExtended(hold, { newReleaseAt: CREATED_AT + 90_000n, tier: 3 }),
    );
    expect(
      result.map((row) => [
        row.kind === 'window_extended' && row.pda,
        'release_at' in row && row.release_at,
      ]),
    ).toEqual([
      [other.hold, Number(CREATED_AT) + 86_400],
      [hold.hold, Number(CREATED_AT) + 90_000],
    ]);
  });

  it('drops events the mirror does not store', () => {
    const trust = eventLog('TrustSet', {
      sender: hold.sender,
      recipient: hold.recipient,
      timestamp: 1n,
    });
    expect(rows(trust, holdCreated(hold)).map((row) => row.kind)).toEqual(['hold_created']);
  });
});

describe('stablecoins', () => {
  it('knows devnet USDC without configuration', () => {
    expect(stablecoins.get(DEVNET_USDC)).toBe(6);
  });

  it('adds mints from the environment to the built-in list', () => {
    const mint = address();
    const parsed = parseStablecoins(` ${mint}:9 , ${DEVNET_USDC}:6,`);
    expect(parsed.get(mint)).toBe(9);
    expect(parsed.get(DEVNET_USDC)).toBe(6);
  });

  it('refuses a malformed list instead of ignoring part of it', () => {
    for (const spec of ['not-a-mint:6', `${address()}`, `${address()}:six`, `${address()}:99`]) {
      expect(() => parseStablecoins(spec)).toThrow(/USD_STABLECOIN_MINTS/);
    }
  });

  it('converts base units to dollars, rounding half up to the cent', () => {
    expect(toUsd(25_000_000n, 6)).toBe('25.00');
    expect(toUsd(1n, 6)).toBe('0.00');
    expect(toUsd(4_999n, 6)).toBe('0.00');
    expect(toUsd(5_000n, 6)).toBe('0.01');
    expect(toUsd(1_234_567_891n, 6)).toBe('1234.57');
    expect(toUsd(199n, 2)).toBe('1.99');
    expect(toUsd(7n, 0)).toBe('7.00');
    expect(toUsd(18_446_744_073_709_551_615n, 6)).toBe('18446744073709.55');
  });

  it('gives no value to SOL or unlisted mints', () => {
    expect(usdValue(stablecoins, null, 1_000_000_000n)).toBeNull();
    expect(usdValue(stablecoins, address(), 1_000_000n)).toBeNull();
    expect(usdValue(stablecoins, DEVNET_USDC, 1_500_000n)).toBe('1.50');
  });
});
