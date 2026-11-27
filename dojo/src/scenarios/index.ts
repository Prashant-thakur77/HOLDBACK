/**
 * The scenario corpus. Each entry is written from a publicly known pattern
 * (named in its `basis`), with its own invented people, wording and details.
 */
import type { Scenario } from '../types';
import { AUTHORITY_SCAMS } from './authority';
import { COMMERCE_SCAMS } from './commerce';
import { CRYPTO_SCAMS } from './crypto';
import { INVESTMENT_SCAMS } from './investment';
import { LEGITIMATE_BILLS } from './legitimate-bills';
import { LEGITIMATE_COMMERCE } from './legitimate-commerce';
import { LEGITIMATE_PEOPLE } from './legitimate-people';
import { RELATIONSHIP_SCAMS } from './relationships';
import { SUPPORT_SCAMS } from './support';
import { WORK_SCAMS } from './work';

export { ADVISORY } from './sources';

export const SCENARIOS: readonly Scenario[] = [
  ...AUTHORITY_SCAMS,
  ...SUPPORT_SCAMS,
  ...INVESTMENT_SCAMS,
  ...RELATIONSHIP_SCAMS,
  ...WORK_SCAMS,
  ...COMMERCE_SCAMS,
  ...CRYPTO_SCAMS,
  ...LEGITIMATE_BILLS,
  ...LEGITIMATE_PEOPLE,
  ...LEGITIMATE_COMMERCE,
];

/** Looks up a scenario by the `scenario_id` of a round recap, for example to show its transcript on an end screen. */
export function findScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}

/**
 * Recipient addresses of every scam scenario. The risk agent's seed data can
 * register these as training fixtures so `check_address` has something to find.
 */
export function scamAddressFixtures(): {
  address: string;
  scenario_id: string;
  category: string;
}[] {
  return SCENARIOS.filter((scenario) => scenario.truth === 'scam').map((scenario) => ({
    address: scenario.ask.to,
    scenario_id: scenario.id,
    category: scenario.category,
  }));
}
