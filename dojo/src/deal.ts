/**
 * Dealing: which eight scenarios a run plays, in which order. A pure function
 * of the seed, so nothing about the deck has to be stored with the run.
 */
import { createRng, shuffle } from './rng';
import { RULES } from './rules';
import { SCENARIOS } from './scenarios';
import type { Scenario } from './types';

/**
 * Picks `count` scams, preferring categories not yet in the hand so one run
 * does not show three variations of the same trick.
 */
function pickVariedScams(shuffledScams: Scenario[], count: number): Scenario[] {
  const picked: Scenario[] = [];
  const categories = new Set<string>();
  for (const scenario of shuffledScams) {
    if (picked.length === count) return picked;
    if (categories.has(scenario.category)) continue;
    categories.add(scenario.category);
    picked.push(scenario);
  }
  for (const scenario of shuffledScams) {
    if (picked.length === count) break;
    if (!picked.includes(scenario)) picked.push(scenario);
  }
  return picked;
}

/** The scenarios of a run, one per round, in play order. */
export function dealRun(seed: string, corpus: readonly Scenario[] = SCENARIOS): Scenario[] {
  const rng = createRng(seed);
  const { usual, sometimes, sometimesChance } = RULES.legitimatePerRun;
  const legitimateCount = rng() < sometimesChance ? sometimes : usual;

  const legitimate = shuffle(
    corpus.filter((scenario) => scenario.truth === 'legitimate'),
    rng,
  ).slice(0, legitimateCount);
  const scams = pickVariedScams(
    shuffle(
      corpus.filter((scenario) => scenario.truth === 'scam'),
      rng,
    ),
    RULES.maxRounds - legitimateCount,
  );
  return shuffle([...legitimate, ...scams], rng);
}
