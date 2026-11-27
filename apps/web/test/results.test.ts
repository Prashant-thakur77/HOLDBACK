import { PROGRAM_ID as SDK_PROGRAM_ID } from '@holdback/sdk';
import { describe, expect, it } from 'vitest';

import { flattenResults, parseInvariants, parseResults, readEvaluation } from '@/lib/results';
import { PROGRAM_ID } from '@/lib/site';

describe('parseInvariants', () => {
  it('reads the property-test counts', () => {
    const text =
      '{"invariant_cases":100000,"instructions_executed":609726,"holds_opened":101379,"violations":0}';
    expect(parseInvariants(text)).toEqual({
      cases: 100000,
      instructions: 609726,
      holdsOpened: 101379,
      violations: 0,
    });
  });

  it('returns null for a missing, broken or incomplete file', () => {
    expect(parseInvariants(undefined)).toBeNull();
    expect(parseInvariants('')).toBeNull();
    expect(parseInvariants('{not json')).toBeNull();
    expect(parseInvariants('{"invariant_cases":1}')).toBeNull();
  });
});

describe('parseResults', () => {
  it('is null until the evaluation has been run', () => {
    expect(parseResults('')).toBeNull();
    expect(parseResults('{}')).toBeNull();
  });

  it('prints a proportion with its counts and keeps the path', () => {
    const rows = flattenResults({
      test: { recall: { successes: 9, n: 12, value: 0.75 }, n_addresses: 1200 },
      policy_version: 'v1',
    });
    expect(rows).toEqual([
      { path: 'test.recall', value: '75.0% (9 of 12)' },
      { path: 'test.n_addresses', value: '1,200' },
      { path: 'policy_version', value: 'v1' },
    ]);
  });

  it('does not invent a rate when the sample is empty', () => {
    const rows = flattenResults({ recall: { successes: 0, n: 0, value: null } });
    expect(rows).toEqual([{ path: 'recall', value: 'not available (0 of 0)' }]);
  });
});

describe('site constants', () => {
  it('prints the program id the SDK was built for', () => {
    expect(PROGRAM_ID).toBe(SDK_PROGRAM_ID.toBase58());
  });
});

describe('readEvaluation', () => {
  const file = JSON.stringify({
    generated_at: '2026-11-27T15:48:29+00:00',
    git: { commit: 'abc1234', uncommitted_changes: true },
    environment: {
      guardian: {
        assessments: 102,
        collectors_unavailable_in_every_assessment: ['helius'],
        collectors_answering_in_every_assessment: ['sns'],
      },
    },
    config: { assumed_amount_usd: 1000, assumed_amount_is_an_assumption: true },
    dataset: { rows: 102, rows_by_label: { scam: 4, legit: 54, fresh: 44 } },
    baseline: { splits: { heldout: { recall: { successes: 0, n: 3, value: 0 } } } },
    holdback: {
      splits: {
        heldout: {
          recall: { successes: 0, n: 3, value: 0, ci95_low: 0, ci95_high: 0.56 },
          false_positive_rate: { successes: 0, n: 54, value: 0 },
          replay: {
            table: [{ delay: '10 min', payments: 3, payments_reclaimable: 3 }, { delay: 'broken' }],
          },
        },
        undated: { recall: { successes: 0, n: 0, value: null } },
      },
    },
    negative_result: { n: 44, caught: { successes: 0, n: 44, value: 0 }, windows_secs: [1800] },
    limitations: ['The held-out scam set has n = 3.'],
  });

  it('keeps the counts behind every rate, including a zero', () => {
    const result = readEvaluation(file);
    expect(result?.splits.map((split) => split.name)).toEqual(['heldout']);
    expect(result?.splits[0]?.holdback.recall).toEqual({
      successes: 0,
      n: 3,
      value: 0,
      low: 0,
      high: 0.56,
    });
    expect(result?.negative?.caught?.n).toBe(44);
    expect(result?.unavailableCollectors).toEqual(['helius']);
    expect(result?.uncommittedChanges).toBe(true);
    expect(result?.limitations).toHaveLength(1);
  });

  it('drops replay rows it cannot read instead of guessing', () => {
    const result = readEvaluation(file);
    expect(result?.replay[0]?.rows).toEqual([
      { delay: '10 min', payments: 3, reclaimable: 3, plainTransferShare: null },
    ]);
  });

  it('shows an assumed amount only when the file marks it as an assumption', () => {
    expect(readEvaluation(file)?.assumedAmountUsd).toBe(1000);
    expect(readEvaluation('{"config":{"assumed_amount_usd":5}}')?.assumedAmountUsd).toBeNull();
  });

  it('is null without a file', () => {
    expect(readEvaluation('')).toBeNull();
    expect(readEvaluation('{}')).toBeNull();
    expect(readEvaluation('not json')).toBeNull();
  });
});
