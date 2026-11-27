/**
 * The game engine: pure, synchronous and deterministic.
 *
 * A run is fully described by its public `DojoState` plus a secret seed. The
 * seed decides which scenarios are dealt; the state records what the player
 * has done. Nothing here reads a clock, the network or a random source, so
 * the same seed and the same moves always produce the same state, on a
 * server, in a browser or offline on a phone.
 */
import { shortAddress } from './base58';
import { dealRun } from './deal';
import { DECISION_RULES, RULES, decisionPoints } from './rules';
import { sha256Hex } from './sha256';
import {
  DECISIONS,
  MOVES,
  type AddressCheck,
  type Decision,
  type DecisionOutcome,
  type DojoState,
  type HistoryEntry,
  type Investigation,
  type InvestigationOutcome,
  type Move,
  type MoveOutcome,
  type PublicScenario,
  type RevealedClue,
  type RoundRecap,
  type RunResult,
  type Scenario,
} from './types';

/** Longest agent summary kept in the state, so one verdict cannot bloat a response. */
const MAX_SUMMARY_CHARS = 280;

const CORRECT_OUTCOMES = new Set<string>(
  Object.values(DECISION_RULES)
    .flatMap((byDecision) => Object.values(byDecision))
    .filter((decisionRule) => decisionRule.correct)
    .map((decisionRule) => decisionRule.outcome),
);

export function isMove(value: unknown): value is Move {
  return typeof value === 'string' && (MOVES as readonly string[]).includes(value);
}

function isDecision(move: Move): move is Decision {
  return (DECISIONS as readonly string[]).includes(move);
}

/** The scenario a seed deals for a 1-based round. */
export function scenarioForRound(seed: string, round: number): Scenario {
  const scenario = dealRun(seed)[round - 1];
  if (!scenario) throw new Error(`No scenario for round ${round}`);
  return scenario;
}

/** The part of a scenario a player may see before deciding. */
function publicScenario(scenario: Scenario): PublicScenario {
  return {
    channel: scenario.channel,
    from: scenario.from,
    transcript: scenario.transcript,
    ask: {
      amount: scenario.ask.amount,
      currency: 'USDC',
      to: scenario.ask.to,
      purpose: scenario.ask.purpose,
    },
  };
}

/** Decisions are always open; each investigation is open until it is used up. */
function legalMoves(scenario: Scenario, revealed: RevealedClue[]): Move[] {
  const questionsAsked = revealed.filter((clue) => clue.source === 'question').length;
  const used = new Set(revealed.map((clue) => clue.source));
  return MOVES.filter((move) => {
    if (move === 'ask_question') return questionsAsked < scenario.clues.length;
    if (move === 'verify_identity') return !used.has('identity');
    if (move === 'check_address') return !used.has('address');
    return true;
  });
}

export interface StartRunInput {
  runId: string;
  /** Secret. Whoever knows it can work out every answer of the run. */
  seed: string;
  player?: string;
}

export function startRun({ runId, seed, player = 'anonymous' }: StartRunInput): DojoState {
  const first = scenarioForRound(seed, 1);
  return {
    run_id: runId,
    player,
    status: 'playing',
    done: false,
    turn: 0,
    round: 1,
    max_rounds: RULES.maxRounds,
    rounds_survived: 0,
    lives: RULES.startingLives,
    score: 0,
    win_score: RULES.winScore,
    wallet: RULES.startingWallet,
    money_at_risk: first.ask.amount,
    money_lost: 0,
    money_recovered: 0,
    scenario: publicScenario(first),
    revealed_clues: [],
    points_available: RULES.roundPoints,
    legal_moves: legalMoves(first, []),
    last_round: null,
    history: [],
    result: null,
  };
}

const UNAVAILABLE_REASON: Record<Investigation, string> = {
  ask_question: 'every clue for this request is already revealed',
  verify_identity: 'the official channel was already checked this round',
  check_address: 'the address was already checked this round',
};

/**
 * Why a move would be rejected, or `null` when it would be applied.
 *
 * `turn` is the value of `state.turn` the caller acted on. It makes a retry
 * safe: a move that already landed is recognised by its turn and not applied
 * a second time. `null` means the caller sent no turn and accepts that risk.
 */
export function checkMove(state: DojoState, move: unknown, turn: number | null): string | null {
  if (state.done) {
    return `The run is over (${state.status}, ${state.score} points). Start a new run to play again.`;
  }
  if (turn !== null && turn !== state.turn) {
    const played = state.history[turn];
    if (played && played.move === move) {
      return `Turn ${turn} was already played as ${played.move} and was not applied again. The run is at turn ${state.turn}: send turn ${state.turn} with your next move.`;
    }
    return `Wrong turn: you sent ${turn}, the run is at turn ${state.turn}. Nothing changed. Send turn ${state.turn}.`;
  }
  const legal = `Legal moves: ${state.legal_moves.join(', ')}.`;
  if (!isMove(move)) return `Unknown move ${JSON.stringify(move) ?? 'undefined'}. ${legal}`;
  if (!state.legal_moves.includes(move)) {
    // Only investigations ever leave the list while a run is being played.
    return `${move} is not available now: ${UNAVAILABLE_REASON[move as Investigation]}. ${legal}`;
  }
  return null;
}

function formatWindow(seconds: number): string {
  if (seconds <= 0) return 'none';
  if (seconds < 3_600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)} h`;
  return `${Math.round(seconds / 86_400)} d`;
}

function addressClue(scenario: Scenario, check: AddressCheck): string {
  const address = shortAddress(scenario.ask.to);
  if (!check.available) {
    return `Verdict unavailable: the HOLDBACK risk agent did not answer for ${address}. This check cost no points.`;
  }
  const summary = check.summary.replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY_CHARS);
  return `HOLDBACK risk agent on ${address}: tier ${check.tier}, risk score ${check.score}, undo window ${formatWindow(check.window_secs)}. ${summary}`.trim();
}

interface Reveal {
  clue: RevealedClue;
  outcome: InvestigationOutcome;
  cost: number;
}

function reveal(
  state: DojoState,
  scenario: Scenario,
  move: Investigation,
  addressCheck: AddressCheck,
): Reveal {
  const cost = RULES.investigationCost[move];
  if (move === 'verify_identity') {
    return {
      clue: { source: 'identity', text: scenario.identity.text },
      outcome: 'identity_checked',
      cost,
    };
  }
  if (move === 'check_address') {
    return {
      clue: { source: 'address', text: addressClue(scenario, addressCheck) },
      outcome: addressCheck.available ? 'address_checked' : 'address_unavailable',
      // The player should not pay for the agent being down.
      cost: addressCheck.available ? cost : 0,
    };
  }
  const asked = state.revealed_clues.filter((clue) => clue.source === 'question').length;
  const next = scenario.clues[asked];
  if (!next) throw new Error(`Scenario ${scenario.id} has no clue ${asked}`);
  return { clue: { source: 'question', text: next.text }, outcome: 'clue_revealed', cost };
}

function investigate(
  state: DojoState,
  scenario: Scenario,
  move: Investigation,
  addressCheck: AddressCheck,
): DojoState {
  const revealed = reveal(state, scenario, move, addressCheck);
  const clues = [...state.revealed_clues, revealed.clue];
  return {
    ...state,
    turn: state.turn + 1,
    revealed_clues: clues,
    points_available: state.points_available - revealed.cost,
    legal_moves: legalMoves(scenario, clues),
    // Investigations never change the score, only what the round is still worth.
    history: [...state.history, entry(state, move, revealed.outcome, 0)],
  };
}

function entry(
  state: DojoState,
  move: Move,
  outcome: HistoryEntry['outcome'],
  points: number,
): HistoryEntry {
  return { turn: state.turn, round: state.round, move, outcome, points };
}

function recap(
  scenario: Scenario,
  round: number,
  decision: Decision,
  outcome: DecisionOutcome,
  points: number,
): RoundRecap {
  return {
    round,
    scenario_id: scenario.id,
    category: scenario.category,
    was_scam: scenario.truth === 'scam',
    decision,
    outcome,
    correct: CORRECT_OUTCOMES.has(outcome),
    points,
    amount: scenario.ask.amount,
    tells: scenario.tells,
    lesson: scenario.lesson,
  };
}

/**
 * The line-based form of a history that gets hashed into the memo: one line
 * per move, `turn|round|move|outcome|points`, joined by `\n`. Anyone holding
 * the public state can rebuild it and check the hash on-chain.
 */
export function canonicalHistory(history: readonly HistoryEntry[]): string {
  return history
    .map((item) => [item.turn, item.round, item.move, item.outcome, item.points].join('|'))
    .join('\n');
}

export function memoText(runId: string, score: number, historyHash: string): string {
  return `holdback-dojo:${runId}:${score}:${historyHash}`;
}

function finish(state: DojoState, reason: RunResult['reason']): DojoState {
  const outcome = reason === 'cleared' ? 'won' : 'lost';
  const historyHash = sha256Hex(canonicalHistory(state.history));
  return {
    ...state,
    status: outcome,
    done: true,
    money_at_risk: 0,
    scenario: null,
    revealed_clues: [],
    points_available: 0,
    legal_moves: [],
    result: {
      outcome,
      reason,
      score: state.score,
      rounds_survived: state.rounds_survived,
      correct_decisions: state.history.filter((item) => CORRECT_OUTCOMES.has(item.outcome)).length,
      money_lost: state.money_lost,
      money_recovered: state.money_recovered,
      history_sha256: historyHash,
      memo: memoText(state.run_id, state.score, historyHash),
      memo_status: 'pending',
      memo_signature: null,
    },
  };
}

function decide(state: DojoState, seed: string, scenario: Scenario, move: Decision): DojoState {
  const decisionRule = DECISION_RULES[scenario.truth][move];
  const points = decisionPoints(decisionRule, state.points_available);
  const amount = scenario.ask.amount;
  const lives = state.lives - (decisionRule.costsLife ? 1 : 0);
  const score = state.score + points;
  const leavesWallet = decisionRule.money === 'spent' || decisionRule.money === 'lost';

  const resolved: DojoState = {
    ...state,
    turn: state.turn + 1,
    lives,
    score,
    rounds_survived: state.rounds_survived + (lives > 0 ? 1 : 0),
    wallet: state.wallet - (leavesWallet ? amount : 0),
    money_lost: state.money_lost + (decisionRule.money === 'lost' ? amount : 0),
    money_recovered: state.money_recovered + (decisionRule.money === 'recovered' ? amount : 0),
    last_round: recap(scenario, state.round, move, decisionRule.outcome, points),
    history: [...state.history, entry(state, move, decisionRule.outcome, points)],
  };

  if (lives === 0) return finish(resolved, 'out_of_lives');
  if (state.round === RULES.maxRounds) {
    return finish(resolved, score >= RULES.winScore ? 'cleared' : 'below_win_score');
  }

  const next = scenarioForRound(seed, state.round + 1);
  return {
    ...resolved,
    round: state.round + 1,
    scenario: publicScenario(next),
    money_at_risk: next.ask.amount,
    revealed_clues: [],
    points_available: RULES.roundPoints,
    legal_moves: legalMoves(next, []),
  };
}

/**
 * Applies one move. A rejected move returns the input state untouched with the
 * reason in `error`; it never throws for anything a player can send.
 *
 * `addressCheck` is only read for `check_address`. Leaving it out means the
 * risk agent could not be reached.
 */
export function applyMove(
  state: DojoState,
  seed: string,
  move: unknown,
  turn: number | null,
  addressCheck: AddressCheck = { available: false },
): MoveOutcome {
  const error = checkMove(state, move, turn);
  if (error !== null) return { state, applied: false, error };

  const accepted = move as Move;
  const scenario = scenarioForRound(seed, state.round);
  const next = isDecision(accepted)
    ? decide(state, seed, scenario, accepted)
    : investigate(state, scenario, accepted, addressCheck);
  return { state: next, applied: true, error: null };
}

/**
 * Records how the end-of-run memo went. `null` means the write failed or
 * timed out; the run result is complete either way.
 */
export function attachMemo(state: DojoState, signature: string | null): DojoState {
  if (!state.result) throw new Error('attachMemo needs a finished run');
  return {
    ...state,
    result: {
      ...state.result,
      memo_status: signature ? 'written' : 'unavailable',
      memo_signature: signature,
    },
  };
}

/** The truth about every round already decided, for spectators and end screens. */
export function revealRounds(state: DojoState, seed: string): RoundRecap[] {
  const deck = dealRun(seed);
  return state.history.flatMap((item) => {
    const scenario = deck[item.round - 1];
    if (!scenario || !isDecision(item.move)) return [];
    return [recap(scenario, item.round, item.move, item.outcome as DecisionOutcome, item.points)];
  });
}
