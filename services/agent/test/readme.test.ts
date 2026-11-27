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
});
