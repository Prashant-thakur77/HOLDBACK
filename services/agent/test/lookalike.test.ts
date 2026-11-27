import { describe, expect, it } from 'vitest';

import { WELL_KNOWN_NAMES, editDistance, lookalikeOf, skeleton } from '../src/collectors/lookalike';
import { nameSignals } from '../src/collectors/sns';

describe('skeleton', () => {
  it('maps confusable characters to what they resemble', () => {
    expect(skeleton('b1nance.sol')).toBe(skeleton('binance'));
    expect(skeleton('PHANT0M')).toBe(skeleton('phantom'));
    expect(skeleton('rnagiceden')).toBe(skeleton('magiceden'));
    expect(skeleton('so-la_na')).toBe('solana');
  });
});

describe('edit distance', () => {
  it('counts insertions, deletions, substitutions and swaps as one edit each', () => {
    expect(editDistance('jupiter', 'jupiter')).toBe(0);
    expect(editDistance('jupiter', 'jupitr')).toBe(1);
    expect(editDistance('jupiter', 'jupiterr')).toBe(1);
    expect(editDistance('jupiter', 'jupitar')).toBe(1);
    expect(editDistance('jupiter', 'jupitre')).toBe(1);
    expect(editDistance('jupiter', 'saturn')).toBeGreaterThan(2);
  });
});

describe('lookalikeOf', () => {
  it('never flags the well-known names themselves', () => {
    for (const name of WELL_KNOWN_NAMES) {
      expect(lookalikeOf(name), name).toBeNull();
      expect(lookalikeOf(`${name}.sol`), name).toBeNull();
    }
  });

  it('catches homoglyphs', () => {
    expect(lookalikeOf('b1nance.sol')).toBe('binance');
    expect(lookalikeOf('phant0m.sol')).toBe('phantom');
    expect(lookalikeOf('c0inbase')).toBe('coinbase');
    // Cyrillic "а" and "о".
    expect(lookalikeOf('sоlаnа.sol')).toBe('solana');
    expect(lookalikeOf('rnagiceden.sol')).toBe('magiceden');
  });

  it('catches one-letter changes', () => {
    expect(lookalikeOf('jupitr.sol')).toBe('jupiter');
    expect(lookalikeOf('phantomm.sol')).toBe('phantom');
    expect(lookalikeOf('solfalre.sol')).toBe('solflare');
    expect(lookalikeOf('bakcpack.sol')).toBe('backpack');
  });

  it('allows two edits only for long names', () => {
    expect(lookalikeOf('solanamobille.sol')).toBe('solanamobile');
    expect(lookalikeOf('solanamobilexx.sol')).toBe('solanamobile');
    expect(lookalikeOf('krakenxx.sol')).toBeNull();
  });

  it('catches a brand wrapped in an impersonation word', () => {
    expect(lookalikeOf('phantom-support.sol')).toBe('phantom');
    expect(lookalikeOf('officialbinance.sol')).toBe('binance');
    expect(lookalikeOf('jupiter_airdrop.sol')).toBe('jupiter');
    expect(lookalikeOf('orca-help.sol')).toBe('orca');
  });

  it('leaves unrelated names alone', () => {
    for (const name of [
      'alice.sol',
      'prashant.sol',
      'toly.sol',
      'coffee-shop.sol',
      'orbit.sol',
      'x',
    ]) {
      expect(lookalikeOf(name), name).toBeNull();
    }
  });
});

describe('name signals', () => {
  it('reports a look-alike with the name it imitates', () => {
    const signals = nameSignals({ primary: 'phantom-support', all: ['phantom-support', 'alice'] });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      source: 'sns',
      signal: 'lookalike_name',
      matched: 'phantom-support.sol',
    });
    expect(signals[0]!.detail).toContain('phantom.sol');
  });

  it('reports an ordinary primary name as information', () => {
    expect(nameSignals({ primary: 'alice', all: ['alice'] })).toMatchObject([
      { signal: 'sol_name', matched: 'alice.sol' },
    ]);
    expect(nameSignals({ primary: null, all: [] })).toEqual([]);
  });
});
