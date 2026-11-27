import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  collectorTable,
  groupCaps,
  policyTable,
  thresholdTable,
  tierTable,
} from '../scripts/readme-tables';
import { POLICY_VERSION } from '../src/policy';
import {
  MAX_EVIDENCE_DOCUMENTS,
  REFRESH_INTERVAL_SECS,
  RETRY_AFTER_SECS,
} from '../src/store/memory';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

/** Table rows as cell lists, so column padding does not matter. */
const rows = (markdown: string) =>
  markdown
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|[\s|:-]+\|$/.test(line))
    .map((line) =>
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim())
        .join(' | '),
    );

describe('README', () => {
  const documented = new Set(rows(readme));

  it.each([
    ['tiers', tierTable()],
    ['policy rules', policyTable()],
    ['collector limits', collectorTable()],
    ['thresholds', thresholdTable()],
  ])('documents the %s exactly as the code defines them', (_name, table) => {
    for (const row of rows(table)) expect(documented, row).toContain(row);
  });

  it('states the policy version and the group cap in force', () => {
    expect(readme).toContain(POLICY_VERSION);
    expect(readme).toContain(groupCaps());
  });

  it('describes the in-memory mode with the limits the code applies', () => {
    expect(readme).toContain(`The last ${MAX_EVIDENCE_DOCUMENTS} assessments`);
    // "an hour old" and "after a minute" in the text are these two constants.
    expect(REFRESH_INTERVAL_SECS).toBe(3_600);
    expect(RETRY_AFTER_SECS).toBe(60);
    expect(readme).toContain('downloaded again when they are an hour old');
    expect(readme).toContain('retried after a minute');
  });
});
