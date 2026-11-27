import { describe, expect, it } from 'vitest';

import {
  counterparties,
  firstFunder,
  isBurstActivity,
  isDustSprayer,
  isInstantDrain,
  isSweepPattern,
  transfersOf,
  type ParsedTx,
} from '../src/collectors/heuristics';
import { profileSignals, type WalletProfile } from '../src/collectors/helius';

const WALLET = 'WalletUnderTest1111111111111111111111111111';
const T0 = 1_790_000_000;
const SOL = 1_000_000_000;

let counter = 0;
/** One transaction with a single native transfer. */
function native(from: string, to: string, sol: number, timestamp: number): ParsedTx {
  return {
    signature: `sig${counter++}`,
    timestamp,
    nativeTransfers: [{ fromUserAccount: from, toUserAccount: to, amount: Math.round(sol * SOL) }],
  };
}

function token(from: string, to: string, amount: number, timestamp: number): ParsedTx {
  return {
    signature: `sig${counter++}`,
    timestamp,
    tokenTransfers: [
      { fromUserAccount: from, toUserAccount: to, mint: 'MintA', tokenAmount: amount },
    ],
  };
}

const victims = (count: number) => Array.from({ length: count }, (_, i) => `Victim${i}`);
const run = (txs: ParsedTx[]) => transfersOf(WALLET, txs);

describe('transfersOf', () => {
  it('keeps only transfers that touch the wallet, oldest first, in whole units', () => {
    const transfers = run([
      native('A', WALLET, 2, T0 + 10),
      native('A', 'B', 1, T0 + 5),
      token(WALLET, 'C', 12.5, T0),
      native(WALLET, WALLET, 1, T0),
    ]);
    expect(transfers).toEqual([
      { timestamp: T0, from: WALLET, to: 'C', asset: 'MintA', amount: 12.5 },
      { timestamp: T0 + 10, from: 'A', to: WALLET, asset: 'SOL', amount: 2 },
    ]);
  });
});

describe('sweep pattern', () => {
  it('fires when 5 senders pay in and 80% of outflow goes to two wallets', () => {
    const txs = [
      ...victims(5).map((victim, i) => native(victim, WALLET, 1, T0 + i)),
      native(WALLET, 'Collector1', 2, T0 + 100),
      native(WALLET, 'Collector1', 1, T0 + 110),
      native(WALLET, 'Collector2', 1, T0 + 120),
      native(WALLET, 'Collector1', 0.5, T0 + 130),
      native(WALLET, 'Other', 0.1, T0 + 140),
    ];
    expect(isSweepPattern(WALLET, run(txs))).toBe(true);
  });

  it('does not fire with only 4 senders', () => {
    const txs = [
      ...victims(4).map((victim, i) => native(victim, WALLET, 1, T0 + i)),
      native(WALLET, 'Collector1', 2, T0 + 100),
      native(WALLET, 'Collector1', 1, T0 + 110),
      native(WALLET, 'Collector1', 1, T0 + 120),
    ];
    expect(isSweepPattern(WALLET, run(txs))).toBe(false);
  });

  it('does not fire for an ordinary wallet that pays many different people', () => {
    const txs = [
      ...victims(6).map((victim, i) => native(victim, WALLET, 1, T0 + i)),
      ...['Shop1', 'Shop2', 'Shop3', 'Shop4', 'Shop5'].map((shop, i) =>
        native(WALLET, shop, 0.5, T0 + 100 + i),
      ),
    ];
    expect(isSweepPattern(WALLET, run(txs))).toBe(false);
  });

  it('needs at least 3 outgoing transfers', () => {
    const txs = [
      ...victims(6).map((victim, i) => native(victim, WALLET, 1, T0 + i)),
      native(WALLET, 'Collector1', 5, T0 + 100),
      native(WALLET, 'Collector1', 1, T0 + 110),
    ];
    expect(isSweepPattern(WALLET, run(txs))).toBe(false);
  });
});

describe('instant drain', () => {
  it('fires when deposits leave again within ten minutes', () => {
    const txs = [
      native('V1', WALLET, 1, T0),
      native(WALLET, 'Out', 0.95, T0 + 60),
      native('V2', WALLET, 2, T0 + 1_000),
      native(WALLET, 'Out', 1.99, T0 + 1_300),
      token('V3', WALLET, 500, T0 + 5_000),
      token(WALLET, 'Out', 500, T0 + 5_599),
    ];
    expect(isInstantDrain(WALLET, run(txs))).toBe(true);
  });

  it('does not fire when the money stays for an hour', () => {
    const txs = [
      native('V1', WALLET, 1, T0),
      native(WALLET, 'Out', 1, T0 + 3_600),
      native('V2', WALLET, 2, T0 + 10_000),
      native(WALLET, 'Out', 2, T0 + 13_700),
      native('V3', WALLET, 1, T0 + 20_000),
      native(WALLET, 'Out', 1, T0 + 23_700),
    ];
    expect(isInstantDrain(WALLET, run(txs))).toBe(false);
  });

  it('does not fire when only a small part leaves', () => {
    const txs = [
      native('V1', WALLET, 1, T0),
      native(WALLET, 'Out', 0.2, T0 + 60),
      native('V2', WALLET, 1, T0 + 1_000),
      native(WALLET, 'Out', 0.2, T0 + 1_060),
      native('V3', WALLET, 1, T0 + 2_000),
      native(WALLET, 'Out', 0.2, T0 + 2_060),
    ];
    expect(isInstantDrain(WALLET, run(txs))).toBe(false);
  });

  it('ignores dust deposits and needs three real ones', () => {
    const txs = [
      native('V1', WALLET, 0.01, T0),
      native(WALLET, 'Out', 0.01, T0 + 10),
      native('V2', WALLET, 1, T0 + 100),
      native(WALLET, 'Out', 1, T0 + 110),
      native('V3', WALLET, 1, T0 + 200),
      native(WALLET, 'Out', 1, T0 + 210),
    ];
    expect(isInstantDrain(WALLET, run(txs))).toBe(false);
  });

  it('does not count an outflow of a different asset', () => {
    const txs = [
      native('V1', WALLET, 1, T0),
      token(WALLET, 'Out', 100, T0 + 10),
      native('V2', WALLET, 1, T0 + 100),
      token(WALLET, 'Out', 100, T0 + 110),
      native('V3', WALLET, 1, T0 + 200),
      token(WALLET, 'Out', 100, T0 + 210),
    ];
    expect(isInstantDrain(WALLET, run(txs))).toBe(false);
  });
});

describe('dust sprayer', () => {
  it('fires on 20 tiny transfers to 15 or more wallets', () => {
    const txs = Array.from({ length: 20 }, (_, i) =>
      native(WALLET, `Target${i % 16}`, 0.000001, T0 + i),
    );
    expect(isDustSprayer(WALLET, run(txs))).toBe(true);
  });

  it('does not fire on 19 transfers', () => {
    const txs = Array.from({ length: 19 }, (_, i) =>
      native(WALLET, `Target${i}`, 0.000001, T0 + i),
    );
    expect(isDustSprayer(WALLET, run(txs))).toBe(false);
  });

  it('does not fire when the amounts are real payments', () => {
    const txs = Array.from({ length: 30 }, (_, i) => native(WALLET, `Target${i}`, 0.01, T0 + i));
    expect(isDustSprayer(WALLET, run(txs))).toBe(false);
  });

  it('does not fire when the dust goes to a few wallets', () => {
    const txs = Array.from({ length: 30 }, (_, i) =>
      native(WALLET, `Target${i % 5}`, 0.000001, T0 + i),
    );
    expect(isDustSprayer(WALLET, run(txs))).toBe(false);
  });
});

describe('burst activity', () => {
  const spread = (count: number, step: number) =>
    Array.from({ length: count }, (_, i) => T0 + i * step);

  it('fires for a wallet under 3 days old with 50 transactions', () => {
    expect(isBurstActivity(2 * 86_400, 50, spread(50, 3_000))).toBe(true);
    expect(isBurstActivity(2 * 86_400, 49, spread(49, 3_000))).toBe(false);
  });

  it('fires for a wallet under 30 days old with 60 transactions in one hour', () => {
    expect(isBurstActivity(10 * 86_400, 80, spread(60, 30))).toBe(true);
    expect(isBurstActivity(10 * 86_400, 80, spread(60, 120))).toBe(false);
  });

  it('never fires for old wallets or wallets of unknown age', () => {
    expect(isBurstActivity(400 * 86_400, 3_000, spread(100, 10))).toBe(false);
    expect(isBurstActivity(null, 3_000, spread(100, 10))).toBe(false);
  });
});

describe('counterparties and first funder', () => {
  const txs = [native('Funder', WALLET, 0.1, T0), native(WALLET, 'Shop', 0.05, T0 + 50)];

  it('lists everyone the wallet dealt with', () => {
    expect(counterparties(WALLET, run(txs))).toEqual(['Funder', 'Shop']);
  });

  it('finds who sent the first SOL', () => {
    expect(firstFunder(WALLET, run(txs))).toBe('Funder');
    expect(firstFunder(WALLET, run([token('X', WALLET, 5, T0)]))).toBeNull();
  });
});

describe('profile to signals', () => {
  const profile = (overrides: Partial<WalletProfile> = {}): WalletProfile => ({
    txCount: 120,
    firstSeen: T0 - 400 * 86_400,
    ageKnown: true,
    firstFunder: 'Funder',
    sweepPattern: false,
    instantDrain: false,
    dustSprayer: false,
    recentTimestamps: [],
    counterparties: ['Funder', 'Shop'],
    inboundBySender: {},
    ...overrides,
  });
  const ids = (p: WalletProfile, listed: string[] = [], sender = 'Sender') =>
    profileSignals(p, sender, T0, new Set(listed)).map((signal) => signal.signal);

  it('reports an established wallet', () => {
    expect(ids(profile())).toEqual(['wallet_established']);
  });

  it('reports an unused address', () => {
    expect(ids(profile({ txCount: 0, firstSeen: null }))).toEqual(['no_history']);
  });

  it('reports wallet age bands', () => {
    expect(ids(profile({ txCount: 3, firstSeen: T0 - 3_600 }))).toEqual(['wallet_new_1d']);
    expect(ids(profile({ txCount: 3, firstSeen: T0 - 3 * 86_400 }))).toEqual(['wallet_new_7d']);
    expect(ids(profile({ txCount: 3, firstSeen: T0 - 30 * 86_400 }))).toEqual([]);
  });

  it('reports listed counterparties and a listed first funder separately', () => {
    expect(ids(profile(), ['Funder', 'Shop'])).toEqual([
      'funded_by_known_bad',
      'known_bad_counterparty',
    ]);
  });

  it('reports earlier payments from this sender', () => {
    const p = profile({ inboundBySender: { Sender: 2 } });
    expect(ids(p)).toEqual(['prior_history_with_sender', 'wallet_established']);
    expect(ids(profile({ inboundBySender: { Sender: 1 } }))).toEqual(['wallet_established']);
  });

  it('does not call a wallet established when a heuristic fired', () => {
    expect(ids(profile({ sweepPattern: true, instantDrain: true }))).toEqual([
      'sweep_pattern',
      'instant_drain',
    ]);
  });
});
