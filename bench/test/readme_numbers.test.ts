/**
 * `scripts/readme_numbers.ts` must be idempotent, must leave everything
 * outside the markers alone, and must leave a README without markers alone.
 * The results document used here is a fixture written in this file.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { check } from 'prettier';

import {
  END,
  START,
  main,
  renderBlock,
  replaceBlock,
  type Results,
} from '../../scripts/readme_numbers';

const proportion = (successes: number, n: number, low: number, high: number) => ({
  successes,
  n,
  value: n === 0 ? null : successes / n,
  ci95_low: n === 0 ? null : low,
  ci95_high: n === 0 ? null : high,
});

const replay = [
  {
    delay: '10 min',
    payments: 3,
    payments_reclaimable: 3,
    share_of_payments: 1,
    share_of_value: 1,
  },
  { delay: '1 h', payments: 3, payments_reclaimable: 0, share_of_payments: 0, share_of_value: 0 },
];

const fixture: Results = {
  generated_at: '2026-11-27T12:00:00+00:00',
  git: { commit: '0123456789abcdef' },
  config: { cutoff_date: '2026-07-01', assumed_amount_usd: 1000 },
  environment: {
    guardian: { collectors_unavailable_in_every_assessment: ['blocklist', 'helius'] },
    dataset_sources_unavailable: ['chainabuse'],
  },
  baseline: {
    splits: {
      heldout: {
        recall: proportion(0, 3, 0, 0.5615),
        false_positive_rate: proportion(0, 80, 0, 0.0458),
        precision: proportion(0, 0, 0, 0),
      },
    },
  },
  holdback: {
    splits: {
      heldout: {
        recall: proportion(1, 3, 0.0615, 0.7923),
        false_positive_rate: proportion(2, 80, 0.0069, 0.0866),
        precision: proportion(1, 3, 0.0615, 0.7923),
        replay: { payments: 3, amounts_stated_by_source: 0, table: replay },
      },
    },
    time_to_verdict: { client_ms: { n: 113, median_ms: 451.2 } },
  },
  negative_result: {
    n: 40,
    caught: proportion(0, 40, 0, 0.0876),
    windows_secs: [1800],
    by_category: { generated_keypair: { caught: proportion(0, 30, 0, 0.1135) } },
    replay,
  },
  latency: {
    assess: {
      cold: { n: 30, p50_ms: 420, p95_ms: 1310.4 },
      warm: { n: 30, p50_ms: 180, p95_ms: 260 },
    },
    chain: {
      available: true,
      create_hold: { n: 5, p50_ms: 912, p95_ms: 1502 },
      reclaim: { n: 5, p50_ms: 870, p95_ms: 1422 },
    },
  },
  program_invariants: { invariant_cases: 100000, instructions_executed: 609726, violations: 0 },
};

const README = `# Project\n\nIntro stays.\n\n## Results\n\n${START}\nold text\n${END}\n\n## After\n\nOutro stays.\n`;

function workspace(readme: string, results: Results | null): string {
  const root = mkdtempSync(join(tmpdir(), 'readme-numbers-'));
  writeFileSync(join(root, 'README.md'), readme);
  writeFileSync(join(root, '.prettierrc.json'), '{"printWidth":100,"singleQuote":true}');
  if (results) {
    mkdirSync(join(root, 'eval'));
    writeFileSync(join(root, 'eval', 'results.json'), JSON.stringify(results));
  }
  return root;
}

test('writes the block, and a second run changes nothing', async () => {
  const root = workspace(README, fixture);
  assert.equal(await main(root), 0);
  const first = readFileSync(join(root, 'README.md'), 'utf8');
  assert.notEqual(first, README);
  assert.equal(await main(root), 0);
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), first);
});

test('only the text between the markers changes', async () => {
  const root = workspace(README, fixture);
  await main(root);
  const updated = readFileSync(join(root, 'README.md'), 'utf8');
  assert.ok(updated.startsWith(`# Project\n\nIntro stays.\n\n## Results\n\n${START}\n`));
  assert.ok(updated.endsWith(`${END}\n\n## After\n\nOutro stays.\n`));
  assert.ok(!updated.includes('old text'));
});

test('numbers come from the results document', async () => {
  const block = await renderBlock(fixture);
  assert.match(block, /1\/3 \(33\.3%, 95% CI 6\.2% to 79\.2%\)/);
  assert.match(block, /no rows \(n = 0\)/);
  assert.match(block, /451 ms \(n = 113\)/);
  assert.match(block, /p50 420 ms, p95 1,310 ms \(n = 30\)/);
  assert.match(block, /Of 40 such wallets/);
  assert.match(block, /100,000 random cases, 609,726 instructions, 0 invariant violations/);
  assert.match(block, /`blocklist`, `helius`/);
});

test('sections that were not run say so instead of showing a number', async () => {
  const block = await renderBlock({
    ...fixture,
    holdback: null,
    latency: null,
    negative_result: null,
  });
  assert.match(block, /Recall on held-out scam addresses\s+\| .* \| not run/);
  assert.match(block, /The fresh-wallet case has not been run/);
});

test('the result is already in prettier style', async () => {
  const root = workspace(README, fixture);
  await main(root);
  const updated = readFileSync(join(root, 'README.md'), 'utf8');
  assert.ok(await check(updated, { parser: 'markdown', printWidth: 100, singleQuote: true }));
});

test('a README without markers is left unchanged', async () => {
  const plain = '# Project\n\nNo markers here.\n';
  const root = workspace(plain, fixture);
  assert.equal(await main(root), 0);
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), plain);
  assert.equal(replaceBlock(plain, 'x'), null);
  assert.equal(replaceBlock(`${END}\n${START}\n`, 'x'), null);
});

test('without results.json the README is left unchanged', async () => {
  const root = workspace(README, null);
  assert.equal(await main(root), 0);
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), README);
});
