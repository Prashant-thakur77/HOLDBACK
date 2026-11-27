import { describe, expect, it } from 'vitest';

import { decodeBase58, encodeBase58, isSolanaAddress, shortAddress } from '../src/base58';
import { dealRun } from '../src/deal';
import { RULES } from '../src/rules';
import { ADVISORY, SCENARIOS, scamAddressFixtures } from '../src/scenarios';
import { CHANNELS, REGIONS } from '../src/types';

const scams = SCENARIOS.filter((scenario) => scenario.truth === 'scam');
const legitimate = SCENARIOS.filter((scenario) => scenario.truth === 'legitimate');

describe('scenario corpus', () => {
  it('has at least 60 scenarios with unique ids', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(SCENARIOS.map((scenario) => scenario.id)).size).toBe(SCENARIOS.length);
  });

  it('is 35-45% legitimate', () => {
    const share = legitimate.length / SCENARIOS.length;
    console.log(
      `corpus: ${SCENARIOS.length} scenarios, ${scams.length} scams, ${legitimate.length} legitimate (${(share * 100).toFixed(1)}%)`,
    );
    expect(share).toBeGreaterThanOrEqual(0.35);
    expect(share).toBeLessThanOrEqual(0.45);
  });

  it('gives every scenario a unique, valid Solana address', () => {
    for (const scenario of SCENARIOS) {
      expect(isSolanaAddress(scenario.ask.to), scenario.id).toBe(true);
    }
    expect(new Set(SCENARIOS.map((scenario) => scenario.ask.to)).size).toBe(SCENARIOS.length);
  });

  it('gives every scam at least two tells and every scenario a lesson', () => {
    for (const scenario of scams)
      expect(scenario.tells.length, scenario.id).toBeGreaterThanOrEqual(2);
    for (const scenario of SCENARIOS) {
      expect(scenario.tells.length, scenario.id).toBeGreaterThanOrEqual(2);
      expect(scenario.lesson.length, scenario.id).toBeGreaterThan(20);
      expect(scenario.basis.length, scenario.id).toBeGreaterThan(20);
    }
  });

  it('keeps every scenario well formed and small', () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.id, scenario.id).toMatch(/^[a-z0-9-]+$/);
      expect(CHANNELS, scenario.id).toContain(scenario.channel);
      expect(REGIONS, scenario.id).toContain(scenario.region);
      expect(scenario.transcript.length, scenario.id).toBeGreaterThanOrEqual(2);
      expect(scenario.transcript.length, scenario.id).toBeLessThanOrEqual(5);
      expect(scenario.clues.length, scenario.id).toBeGreaterThanOrEqual(2);
      expect(scenario.clues.length, scenario.id).toBeLessThanOrEqual(4);
      expect(Number.isInteger(scenario.ask.amount) && scenario.ask.amount > 0, scenario.id).toBe(
        true,
      );
      for (const text of [
        ...scenario.transcript,
        ...scenario.clues.map((clue) => clue.text),
        scenario.identity.text,
        scenario.lesson,
        ...scenario.tells,
      ]) {
        expect(text.length, `${scenario.id}: ${text}`).toBeLessThanOrEqual(260);
        expect(text, scenario.id).not.toContain('@@');
      }
    }
  });

  it('never lets the evidence contradict the ground truth', () => {
    for (const scenario of SCENARIOS) {
      const wrong = scenario.truth === 'scam' ? 'legitimate' : 'scam';
      const signals = [...scenario.clues, scenario.identity].map((clue) => clue.signal);
      expect(signals, scenario.id).not.toContain(wrong);
      // Asking every question must settle the matter.
      expect(
        scenario.clues.map((clue) => clue.signal),
        scenario.id,
      ).toContain(scenario.truth);
    }
  });

  it('leaves a positive reward after every possible investigation', () => {
    const { ask_question, verify_identity, check_address } = RULES.investigationCost;
    for (const scenario of SCENARIOS) {
      const spent = scenario.clues.length * ask_question + verify_identity + check_address;
      expect(RULES.roundPoints - spent, scenario.id).toBeGreaterThanOrEqual(80);
    }
  });

  it('can always be paid from the starting wallet', () => {
    const largest = SCENARIOS.map((scenario) => scenario.ask.amount).sort((a, b) => b - a);
    const worstRun = largest.slice(0, RULES.maxRounds).reduce((sum, amount) => sum + amount, 0);
    expect(worstRun).toBeLessThanOrEqual(RULES.startingWallet);
  });

  it('covers every channel and region, and many scam categories', () => {
    expect(new Set(SCENARIOS.map((scenario) => scenario.channel)).size).toBe(CHANNELS.length);
    expect(new Set(SCENARIOS.map((scenario) => scenario.region)).size).toBe(REGIONS.length);
    const categories = new Set(scams.map((scenario) => scenario.category));
    expect(categories.size).toBeGreaterThanOrEqual(16);
    for (const expected of [
      'authority_impersonation',
      'fake_support',
      'remote_access',
      'verification_transfer',
      'investment',
      'romance',
      'job_fee',
      'marketplace',
      'invoice_fraud',
      'airdrop_drainer',
      'address_poisoning',
      'family_emergency',
      'parcel_fee',
      'account_unlock',
      'charity',
      'rental_deposit',
    ]) {
      expect(categories, expected).toContain(expected);
    }
  });

  it('only cites advisories from the checked list', () => {
    const known = new Set<string>(Object.values(ADVISORY));
    for (const scenario of SCENARIOS) {
      for (const url of scenario.sources ?? []) expect(known, scenario.id).toContain(url);
    }
  });

  it('builds look-alike addresses that share only their ends with the real one', () => {
    const pairs = [
      ['address-poisoning-friend', '5AcjLKqJQUD4Z1TEYf4XJwbr4npChctABgx8aGWkUu1'],
      ['address-poisoning-contractor', '4RVj72MzhswH7jNNJVw6VifdSQCvrZLHWLt4pMZ4A3gs'],
    ] as const;
    for (const [id, real] of pairs) {
      const fake = SCENARIOS.find((scenario) => scenario.id === id)?.ask.to ?? '';
      expect(isSolanaAddress(real)).toBe(true);
      expect(fake).not.toBe(real);
      expect(fake.slice(0, 4)).toBe(real.slice(0, 4));
      expect(fake.slice(-4)).toBe(real.slice(-4));
      // The real address is what the clues show the player.
      const scenario = SCENARIOS.find((item) => item.id === id);
      expect(scenario?.clues.some((clue) => clue.text.includes(real))).toBe(true);
    }
  });

  it('exports one fixture per scam address', () => {
    expect(scamAddressFixtures()).toHaveLength(scams.length);
  });
});

describe('base58', () => {
  it('rejects text that is not a 32-byte base58 value', () => {
    expect(decodeBase58('0OIl')).toBeNull();
    expect(decodeBase58('')).toBeNull();
    expect(isSolanaAddress('abc')).toBe(false);
    expect(isSolanaAddress('11111111111111111111111111111111')).toBe(true);
    expect(decodeBase58('11111111111111111111111111111111')).toEqual(new Uint8Array(32));
  });

  it('encodes back to the same text for every corpus address', () => {
    for (const scenario of SCENARIOS) {
      const bytes = decodeBase58(scenario.ask.to);
      expect(bytes && encodeBase58(bytes), scenario.id).toBe(scenario.ask.to);
    }
    expect(encodeBase58(new Uint8Array([0, 0, 1]))).toBe('112');
    expect(shortAddress('5AcjL4DD1rv7YLjYv2JdWiMBnB6nLBTxvg9Tf6HkUu1')).toBe('5Acj…kUu1');
  });
});

describe('dealing', () => {
  it('is deterministic and never repeats a scenario within a run', () => {
    for (let i = 0; i < 300; i++) {
      const deck = dealRun(`deal-${i}`);
      expect(deck.map((scenario) => scenario.id)).toEqual(
        dealRun(`deal-${i}`).map((scenario) => scenario.id),
      );
      expect(deck).toHaveLength(RULES.maxRounds);
      expect(new Set(deck.map((scenario) => scenario.id)).size).toBe(RULES.maxRounds);
    }
  });

  it('deals three or four legitimate requests, 40% on average, and uses the whole corpus', () => {
    const runs = 4000;
    const seen = new Set<string>();
    let legitimateDealt = 0;
    for (let i = 0; i < runs; i++) {
      const deck = dealRun(`mix-${i}`);
      const count = deck.filter((scenario) => scenario.truth === 'legitimate').length;
      expect([3, 4]).toContain(count);
      legitimateDealt += count;
      for (const scenario of deck) seen.add(scenario.id);
    }
    const share = legitimateDealt / (runs * RULES.maxRounds);
    console.log(`dealt legitimate share over ${runs} runs: ${(share * 100).toFixed(1)}%`);
    expect(share).toBeGreaterThan(0.38);
    expect(share).toBeLessThan(0.42);
    expect(seen.size).toBe(SCENARIOS.length);
  });

  it('avoids repeating a scam category within a run', () => {
    for (let i = 0; i < 300; i++) {
      const categories = dealRun(`variety-${i}`)
        .filter((scenario) => scenario.truth === 'scam')
        .map((scenario) => scenario.category);
      expect(new Set(categories).size).toBe(categories.length);
    }
  });
});
