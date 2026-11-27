import { describe, expect, it } from 'vitest';

import { PLAYERS, playRun, summariseAll, toMarkdown, type Summary } from '../scripts/simulate';
import { scenarioForRound } from '../src/engine';
import { RULES } from '../src/rules';
import { SCENARIOS } from '../src/scenarios';

const RUNS = 1000;
const summaries = summariseAll(RUNS);
const by = (name: string): Summary => {
  const summary = summaries.find((item) => item.player === name);
  if (!summary) throw new Error(`No summary for ${name}`);
  return summary;
};

describe('strategy simulations', () => {
  it('prints the score distributions used to calibrate the bets', () => {
    console.log(`\nScripted players, ${RUNS} seeded runs each:\n${toMarkdown(summaries)}\n`);
    expect(summaries).toHaveLength(Object.keys(PLAYERS).length);
  });

  it('makes every blind strategy lose to an informed player', () => {
    const informed = by('informed');
    for (const blind of [
      'always pay',
      'always refuse',
      'always report',
      'always pay_with_holdback',
    ]) {
      expect(by(blind).mean, blind).toBeLessThan(informed.mean);
      expect(by(blind).max, blind).toBeLessThan(informed.min);
      expect(by(blind).won, blind).toBe(0);
    }
    expect(informed.won).toBe(100);
  });

  it('beats always-refuse with an informed player on every single seed', () => {
    for (let i = 0; i < 300; i++) {
      const seed = `duel-${i}`;
      const refuse = playRun(seed, PLAYERS['always refuse']!);
      const informed = playRun(seed, PLAYERS.informed!);
      expect(informed.score, seed).toBeGreaterThan(refuse.score);
    }
  });

  it('ends always-pay and always-refuse early, out of lives', () => {
    expect(by('always pay').survived_all_rounds).toBe(0);
    expect(by('always refuse').survived_all_rounds).toBe(0);
    expect(by('always pay').mean).toBeLessThan(by('always refuse').mean);
    const run = playRun('always-pay-example', PLAYERS['always pay']!);
    expect(run.result?.reason).toBe('out_of_lives');
    expect(run.money_lost).toBeGreaterThan(0);
  });

  it('lets pay_with_holdback survive every run at about half value, short of a win', () => {
    const hedger = by('always pay_with_holdback');
    expect(hedger.survived_all_rounds).toBe(100);
    expect(hedger.max).toBeLessThan(RULES.winScore);
    for (let i = 0; i < 100; i++) {
      const seed = `hedge-${i}`;
      const run = playRun(seed, PLAYERS['always pay_with_holdback']!);
      const scams = Array.from({ length: RULES.maxRounds }, (_, r) =>
        scenarioForRound(seed, r + 1),
      ).filter((scenario) => scenario.truth === 'scam');
      expect(run.money_lost).toBe(0);
      expect(run.money_recovered).toBe(
        scams.reduce((sum, scenario) => sum + scenario.ask.amount, 0),
      );
      expect(run.score).toBe(
        scams.length * (RULES.roundPoints / 2) +
          (RULES.maxRounds - scams.length) * (RULES.roundPoints * 0.8),
      );
    }
  });

  it('rewards accuracy: better judgement means more wins', () => {
    expect(by('informed, 70% accurate').won).toBeLessThan(by('informed, 80% accurate').won);
    expect(by('informed, 80% accurate').won).toBeLessThan(by('informed, 90% accurate').won);
    expect(by('informed, 90% accurate').won).toBeLessThan(by('informed').won);
  });

  it('stays inside the call budget of 400 per run', () => {
    // Worst case: every investigation in every round, plus one state read per move and the start.
    const longestRound = Math.max(...SCENARIOS.map((scenario) => scenario.clues.length)) + 3;
    const worstCaseCalls = 1 + 2 * longestRound * RULES.maxRounds;
    console.log(
      `worst-case calls per run (start + move + state read each turn): ${worstCaseCalls}`,
    );
    expect(worstCaseCalls).toBeLessThanOrEqual(400);
    for (const summary of summaries) expect(summary.mean_moves * 2 + 1).toBeLessThan(400);
  });

  it('keeps every state far below the 64 KB response limit', () => {
    let largest = 0;
    for (let i = 0; i < 200; i++) {
      const seed = `size-${i}`;
      let finalSize = 0;
      // The exhaustive player reveals everything, which is the largest a state gets.
      const state = playRun(seed, (view) => {
        largest = Math.max(largest, Buffer.byteLength(JSON.stringify(view.state)));
        return PLAYERS.exhaustive!(view);
      });
      finalSize = Buffer.byteLength(JSON.stringify(state));
      largest = Math.max(largest, finalSize);
    }
    console.log(`largest state seen: ${largest} bytes`);
    expect(largest).toBeLessThan(64 * 1024);
    expect(largest).toBeLessThan(16 * 1024);
  });
});
