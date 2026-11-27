/**
 * Every number the game uses. The engine, the simulations, the tests and the
 * documents all read from here, so a rule changes in exactly one place.
 */
import type { Decision, DecisionOutcome, Investigation, Truth } from './types';

export const RULES = {
  maxRounds: 8,
  startingLives: 3,
  /** Practice USDC. Large enough to pay every request in a run (checked by a test). */
  startingWallet: 10_000,
  /** A correct decision with no investigation earns this. */
  roundPoints: 150,
  /** Points an investigation takes off the round. A failed address check is free. */
  investigationCost: {
    ask_question: 10,
    verify_identity: 20,
    check_address: 10,
  } satisfies Record<Investigation, number>,
  /** Added when a scam is reported rather than only refused. */
  reportBonus: 25,
  /** Finishing all rounds with fewer points than this is a loss. */
  winScore: 900,
  /**
   * Legitimate requests per run. Three or four out of eight keeps the long-run
   * share at 40% while stopping a player from counting to an exact number.
   */
  legitimatePerRun: { usual: 3, sometimes: 4, sometimesChance: 0.2 },
} as const;

export interface DecisionRule {
  outcome: DecisionOutcome;
  correct: boolean;
  /** Share of `points_available` awarded, in percent. */
  pointsPercent: number;
  bonus: number;
  costsLife: boolean;
  /** `spent`: paid for something real. `lost`: gone. `recovered`: undone in the window. */
  money: 'kept' | 'spent' | 'lost' | 'recovered';
}

/**
 * What each decision does, by ground truth.
 *
 * `pay_with_holdback` is the hedge: it never costs a life, but a scam paid
 * this way earns half (the undo window got the money back, the player still
 * fell for it) and an honest payee who has to wait out the window earns 80%.
 */
export const DECISION_RULES: Record<Truth, Record<Decision, DecisionRule>> = {
  scam: {
    refuse: rule('scam_refused', true, 100, 0, false, 'kept'),
    report: rule('scam_reported', true, 100, RULES.reportBonus, false, 'kept'),
    pay_with_holdback: rule('scam_recovered', false, 50, 0, false, 'recovered'),
    pay: rule('scam_paid', false, 0, 0, true, 'lost'),
  },
  legitimate: {
    pay: rule('legitimate_paid', true, 100, 0, false, 'spent'),
    pay_with_holdback: rule('legitimate_paid_with_window', true, 80, 0, false, 'spent'),
    refuse: rule('legitimate_refused', false, 0, 0, true, 'kept'),
    report: rule('legitimate_reported', false, 0, 0, true, 'kept'),
  },
};

function rule(
  outcome: DecisionOutcome,
  correct: boolean,
  pointsPercent: number,
  bonus: number,
  costsLife: boolean,
  money: DecisionRule['money'],
): DecisionRule {
  return { outcome, correct, pointsPercent, bonus, costsLife, money };
}

/** Points for a decision, given what is still on the table this round. */
export function decisionPoints(decisionRule: DecisionRule, pointsAvailable: number): number {
  return Math.floor((pointsAvailable * decisionRule.pointsPercent) / 100) + decisionRule.bonus;
}
